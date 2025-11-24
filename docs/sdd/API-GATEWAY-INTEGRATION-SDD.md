# Software Design Document: API Gateway Integration

**Version**: 1.0.0
**Package**: `@authz-engine/integrations`
**Status**: Specification
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

This document defines integration patterns for the AuthZ Engine with popular API gateways and service meshes, enabling centralized authorization at the edge.

### 1.2 Supported Gateways

| Gateway | Protocol | Pattern |
|---------|----------|---------|
| Kong | HTTP/gRPC | Plugin |
| Envoy | gRPC | ext_authz |
| AWS API Gateway | HTTP | Lambda Authorizer |
| Istio | gRPC | AuthorizationPolicy |
| NGINX | HTTP | auth_request |
| Traefik | HTTP | ForwardAuth |

---

## 2. Architecture

### 2.1 External Authorization Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                    External Authorization Flow                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────┐  │
│  │ Client  │───►│ API Gateway │───►│ AuthZ Engine│    │ Backend │  │
│  └─────────┘    └──────┬──────┘    └──────┬──────┘    └─────────┘  │
│                        │                   │                        │
│                        │  1. Auth Request  │                        │
│                        │──────────────────►│                        │
│                        │                   │                        │
│                        │  2. Allow/Deny    │                        │
│                        │◄──────────────────│                        │
│                        │                   │                        │
│                        │  3. If allowed    │                        │
│                        │──────────────────────────────────────────►│ │
│                        │                                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Kong Integration

### 3.1 Custom Plugin

```lua
-- kong/plugins/authz-engine/handler.lua
local http = require "resty.http"
local cjson = require "cjson"

local AuthzEngineHandler = {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}

function AuthzEngineHandler:access(conf)
  local httpc = http.new()
  httpc:set_timeout(conf.timeout)

  -- Build authorization request
  local request_body = cjson.encode({
    principal = {
      id = kong.request.get_header("X-User-ID"),
      roles = self:parse_roles(kong.request.get_header("X-User-Roles")),
    },
    resource = {
      kind = conf.resource_kind or kong.router.get_service().name,
      id = kong.request.get_path_with_query(),
    },
    action = kong.request.get_method():lower(),
  })

  -- Call AuthZ Engine
  local res, err = httpc:request_uri(conf.authz_url .. "/v1/check", {
    method = "POST",
    body = request_body,
    headers = {
      ["Content-Type"] = "application/json",
      ["X-Tenant-ID"] = kong.request.get_header("X-Tenant-ID"),
    },
  })

  if not res then
    kong.log.err("AuthZ Engine error: ", err)
    if conf.fail_open then
      return -- Allow on error
    end
    return kong.response.exit(503, { message = "Authorization service unavailable" })
  end

  local response = cjson.decode(res.body)

  if response.effect ~= "ALLOW" then
    return kong.response.exit(403, {
      message = "Access denied",
      reason = response.reason,
    })
  end

  -- Add derived roles to upstream headers
  if response.derivedRoles then
    kong.service.request.set_header("X-Derived-Roles", table.concat(response.derivedRoles, ","))
  end
end

return AuthzEngineHandler
```

### 3.2 Plugin Schema

```lua
-- kong/plugins/authz-engine/schema.lua
return {
  name = "authz-engine",
  fields = {
    { config = {
      type = "record",
      fields = {
        { authz_url = { type = "string", required = true } },
        { timeout = { type = "number", default = 3000 } },
        { resource_kind = { type = "string" } },
        { fail_open = { type = "boolean", default = false } },
        { cache_ttl = { type = "number", default = 60 } },
      },
    }},
  },
}
```

### 3.3 Kong Configuration

```yaml
# kong.yaml
plugins:
  - name: authz-engine
    config:
      authz_url: http://authz-engine:3592
      timeout: 3000
      fail_open: false
      cache_ttl: 60
    service: my-api
```

---

## 4. Envoy Integration

### 4.1 ext_authz Configuration

```yaml
# envoy.yaml
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8080
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                http_filters:
                  # External authorization filter
                  - name: envoy.filters.http.ext_authz
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
                      grpc_service:
                        envoy_grpc:
                          cluster_name: authz-engine
                        timeout: 0.25s
                      transport_api_version: V3
                      failure_mode_allow: false
                      with_request_body:
                        max_request_bytes: 8192
                        allow_partial_message: true
                      status_on_error:
                        code: 503

  clusters:
    - name: authz-engine
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      http2_protocol_options: {}
      load_assignment:
        cluster_name: authz-engine
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: authz-engine
                      port_value: 3593  # gRPC port
```

### 4.2 gRPC Authorization Service

```typescript
// AuthZ Engine implements Envoy's ext_authz gRPC API
import { CheckRequest, CheckResponse, OkHttpResponse, DeniedHttpResponse } from './proto/envoy/service/auth/v3/external_auth';

class EnvoyAuthzService {
  async check(request: CheckRequest): Promise<CheckResponse> {
    // Extract authorization context from Envoy request
    const attrs = request.attributes?.request?.http;

    const authzRequest = {
      principal: {
        id: attrs?.headers?.['x-user-id'] || 'anonymous',
        roles: this.parseRoles(attrs?.headers?.['x-user-roles']),
      },
      resource: {
        kind: this.extractResourceKind(attrs?.path),
        id: attrs?.path,
      },
      action: attrs?.method?.toLowerCase(),
    };

    // Call decision engine
    const decision = await this.decisionEngine.check(authzRequest);

    if (decision.effect === 'ALLOW') {
      return {
        status: { code: 0 },
        okResponse: {
          headers: [
            { header: { key: 'x-authz-decision', value: 'allow' } },
            { header: { key: 'x-derived-roles', value: decision.derivedRoles?.join(',') || '' } },
          ],
        },
      };
    }

    return {
      status: { code: 7 }, // PERMISSION_DENIED
      deniedResponse: {
        status: { code: 403 },
        body: JSON.stringify({ error: 'Access denied', reason: decision.reason }),
        headers: [
          { header: { key: 'content-type', value: 'application/json' } },
        ],
      },
    };
  }
}
```

---

## 5. AWS API Gateway Integration

### 5.1 Lambda Authorizer

```typescript
// lambda/authorizer.ts
import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';

export async function handler(event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> {
  const token = event.authorizationToken;
  const methodArn = event.methodArn;

  // Decode JWT to get principal info
  const principal = await decodeAndVerifyToken(token);

  // Extract resource info from method ARN
  // arn:aws:execute-api:region:account:api-id/stage/method/resource-path
  const arnParts = methodArn.split(':');
  const apiGatewayArnParts = arnParts[5].split('/');
  const method = apiGatewayArnParts[2];
  const resourcePath = apiGatewayArnParts.slice(3).join('/');

  // Call AuthZ Engine
  const response = await fetch(`${process.env.AUTHZ_ENGINE_URL}/v1/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      principal: {
        id: principal.sub,
        roles: principal.roles,
        attr: principal,
      },
      resource: {
        kind: extractResourceKind(resourcePath),
        id: resourcePath,
      },
      action: method.toLowerCase(),
    }),
  });

  const decision = await response.json();

  if (decision.effect === 'ALLOW') {
    return generatePolicy(principal.sub, 'Allow', methodArn, {
      derivedRoles: decision.derivedRoles?.join(','),
    });
  }

  return generatePolicy(principal.sub, 'Deny', methodArn);
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      }],
    },
    context,
  };
}
```

### 5.2 API Gateway Configuration

```yaml
# serverless.yml
functions:
  authz:
    handler: lambda/authorizer.handler
    environment:
      AUTHZ_ENGINE_URL: ${self:custom.authzEngineUrl}

resources:
  Resources:
    ApiGatewayAuthorizer:
      Type: AWS::ApiGateway::Authorizer
      Properties:
        Name: authz-engine
        Type: TOKEN
        AuthorizerUri:
          Fn::Join:
            - ''
            - - 'arn:aws:apigateway:'
              - Ref: AWS::Region
              - ':lambda:path/2015-03-31/functions/'
              - Fn::GetAtt: [AuthzLambdaFunction, Arn]
              - '/invocations'
        AuthorizerResultTtlInSeconds: 300
        IdentitySource: method.request.header.Authorization
        RestApiId:
          Ref: ApiGatewayRestApi
```

---

## 6. Istio Integration

### 6.1 AuthorizationPolicy

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: authz-engine-ext
  namespace: my-app
spec:
  selector:
    matchLabels:
      app: my-service
  action: CUSTOM
  provider:
    name: authz-engine
  rules:
    - to:
        - operation:
            paths: ["/api/*"]
            methods: ["GET", "POST", "PUT", "DELETE"]
---
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: authz-engine-provider
  namespace: istio-system
spec:
  configPatches:
    - applyTo: CLUSTER
      match:
        context: SIDECAR_OUTBOUND
      patch:
        operation: ADD
        value:
          name: authz-engine
          type: STRICT_DNS
          connect_timeout: 1s
          lb_policy: ROUND_ROBIN
          http2_protocol_options: {}
          load_assignment:
            cluster_name: authz-engine
            endpoints:
              - lb_endpoints:
                  - endpoint:
                      address:
                        socket_address:
                          address: authz-engine.authz.svc.cluster.local
                          port_value: 3593
```

### 6.2 MeshConfig

```yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    extensionProviders:
      - name: authz-engine
        envoyExtAuthzGrpc:
          service: authz-engine.authz.svc.cluster.local
          port: 3593
          timeout: 1s
          failOpen: false
```

---

## 7. NGINX Integration

### 7.1 auth_request Configuration

```nginx
# nginx.conf
upstream authz_engine {
    server authz-engine:3592;
    keepalive 32;
}

server {
    listen 80;

    location /api/ {
        # Authorization subrequest
        auth_request /auth;
        auth_request_set $authz_decision $upstream_http_x_authz_decision;
        auth_request_set $derived_roles $upstream_http_x_derived_roles;

        # Pass derived roles to backend
        proxy_set_header X-Derived-Roles $derived_roles;

        proxy_pass http://backend;
    }

    location = /auth {
        internal;
        proxy_pass http://authz_engine/v1/check;
        proxy_method POST;
        proxy_set_header Content-Type application/json;

        # Build request body
        set $authz_body '{"principal":{"id":"$http_x_user_id"},"resource":{"kind":"api","id":"$request_uri"},"action":"$request_method"}';
        proxy_set_header Content-Length $content_length;

        proxy_pass_request_body off;
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Original-Method $request_method;
    }

    # Handle 403 from auth
    error_page 403 = @forbidden;
    location @forbidden {
        return 403 '{"error": "Access denied"}';
    }
}
```

---

## 8. Traefik Integration

### 8.1 ForwardAuth Middleware

```yaml
# traefik.yaml
http:
  middlewares:
    authz-engine:
      forwardAuth:
        address: http://authz-engine:3592/v1/check
        trustForwardHeader: true
        authResponseHeaders:
          - X-Authz-Decision
          - X-Derived-Roles

  routers:
    my-api:
      rule: "PathPrefix(`/api`)"
      middlewares:
        - authz-engine
      service: my-backend
```

### 8.2 Kubernetes IngressRoute

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: Middleware
metadata:
  name: authz-engine
spec:
  forwardAuth:
    address: http://authz-engine.authz.svc:3592/v1/check
    trustForwardHeader: true
    authResponseHeaders:
      - X-Authz-Decision
      - X-Derived-Roles
---
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: my-api
spec:
  routes:
    - match: PathPrefix(`/api`)
      kind: Rule
      middlewares:
        - name: authz-engine
      services:
        - name: my-backend
          port: 80
```

---

## 9. Common Patterns

### 9.1 Header Propagation

```typescript
// Standard headers for gateway integration
interface AuthzHeaders {
  // Request headers (gateway -> authz)
  'X-User-ID': string;
  'X-User-Roles': string;        // Comma-separated
  'X-Tenant-ID': string;
  'X-Request-ID': string;
  'X-Original-URI': string;
  'X-Original-Method': string;

  // Response headers (authz -> gateway -> backend)
  'X-Authz-Decision': 'allow' | 'deny';
  'X-Derived-Roles': string;     // Comma-separated
  'X-Matched-Policy': string;
}
```

### 9.2 Caching at Gateway

```yaml
# Kong caching example
plugins:
  - name: proxy-cache
    config:
      response_code:
        - 200
        - 403
      request_method:
        - GET
        - POST
      content_type:
        - application/json
      cache_ttl: 60
      strategy: memory
      vary_headers:
        - X-User-ID
        - X-Tenant-ID
```

---

## 10. Performance

### 10.1 Connection Pooling

```yaml
# Envoy connection pool settings
clusters:
  - name: authz-engine
    connect_timeout: 0.25s
    circuit_breakers:
      thresholds:
        - max_connections: 100
          max_pending_requests: 100
          max_requests: 1000
          max_retries: 3
    health_checks:
      - timeout: 1s
        interval: 10s
        healthy_threshold: 2
        unhealthy_threshold: 3
        http_health_check:
          path: /health/ready
```

### 10.2 Timeout Configuration

| Gateway | Recommended Timeout | Rationale |
|---------|-------------------|-----------|
| Kong | 3000ms | Plugin timeout |
| Envoy | 250ms | ext_authz default |
| AWS API GW | 5000ms | Lambda cold start |
| NGINX | 3000ms | auth_request |
| Traefik | 2000ms | forwardAuth |

---

## 11. Security

### 11.1 mTLS Configuration

```yaml
# Envoy mTLS to AuthZ Engine
clusters:
  - name: authz-engine
    transport_socket:
      name: envoy.transport_sockets.tls
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
        common_tls_context:
          tls_certificates:
            - certificate_chain:
                filename: /certs/client.crt
              private_key:
                filename: /certs/client.key
          validation_context:
            trusted_ca:
              filename: /certs/ca.crt
```

---

## 12. Dependencies

| Dependency | Purpose |
|------------|---------|
| Kong 3.x | API Gateway |
| Envoy 1.28+ | Service proxy |
| Istio 1.20+ | Service mesh |
| AWS Lambda | Serverless authorizer |

---

*Last Updated: 2025-11-23*
