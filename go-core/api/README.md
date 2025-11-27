# Authorization Engine API

This directory contains the OpenAPI specification and interactive documentation for the Authorization Engine REST API.

## Files

### OpenAPI Specification
**File**: `openapi.yaml`

Complete OpenAPI 3.0.3 specification documenting all REST API endpoints, request/response schemas, authentication, and error responses.

**Contents**:
- 1,957 lines
- All API endpoints
- Request/response schemas
- Authentication (JWT Bearer)
- Error responses
- Rate limiting
- Examples for all operations

**View Online**:
- Swagger Editor: https://editor.swagger.io/
- Redoc: https://redocly.github.io/redoc/

### Interactive Documentation
**File**: `swagger-ui.html`

Interactive API documentation using Swagger UI. Allows developers to explore and test API endpoints directly in the browser.

**Features**:
- Try it out functionality
- JWT token authentication
- Persistent authentication (localStorage)
- Search functionality
- Custom branding

## Usage

### View OpenAPI Specification

**Online Validators**:
1. Swagger Editor: https://editor.swagger.io/
   - Upload `openapi.yaml`
   - View documentation and test endpoints

2. Redoc: https://redocly.github.io/redoc/
   - Paste `openapi.yaml` URL
   - Clean documentation rendering

**Command Line**:
```bash
# Validate spec
npx @apidevtools/swagger-cli validate openapi.yaml

# Convert to JSON
npx @apidevtools/swagger-cli bundle openapi.yaml --outfile openapi.json --type json
```

### Serve Swagger UI Locally

**Option 1: Python**
```bash
cd api
python3 -m http.server 8000

# Visit: http://localhost:8000/swagger-ui.html
```

**Option 2: Node.js**
```bash
cd api
npx http-server -p 8000

# Visit: http://localhost:8000/swagger-ui.html
```

**Option 3: Docker**
```bash
docker run -p 8080:8080 \
  -v $(pwd):/usr/share/nginx/html/api \
  -e SWAGGER_JSON=/api/openapi.yaml \
  swaggerapi/swagger-ui
```

### Generate Client SDKs

Use the provided script to generate client SDKs:

```bash
# Generate all clients (TypeScript, Python, Go, Java)
../scripts/generate-clients.sh
```

**Manual Generation**:
```bash
# TypeScript/JavaScript
openapi-generator-cli generate \
  -i openapi.yaml \
  -g typescript-axios \
  -o ../clients/typescript

# Python
openapi-generator-cli generate \
  -i openapi.yaml \
  -g python \
  -o ../clients/python

# Go
openapi-generator-cli generate \
  -i openapi.yaml \
  -g go \
  -o ../clients/go

# Java
openapi-generator-cli generate \
  -i openapi.yaml \
  -g java \
  -o ../clients/java
```

## API Overview

### Base URL
```
Production: https://api.authz-engine.example.com/v1
Staging: https://staging-api.authz-engine.example.com/v1
Local: http://localhost:8080/v1
```

### Authentication
All endpoints (except `/health`) require JWT Bearer token:
```
Authorization: Bearer <your-jwt-token>
```

### Endpoints

#### Health
- `GET /health` - Health check (no auth required)
- `GET /v1/status` - Detailed status

#### Authorization
- `POST /v1/authorization/check` - Check single authorization
- `POST /v1/authorization/check-resources` - Batch check multiple resources
- `GET /v1/authorization/allowed-actions` - Get allowed actions

#### Policies
- `GET /v1/policies` - List policies
- `GET /v1/policies/{id}` - Get policy by ID
- `POST /v1/policies` - Create policy
- `PUT /v1/policies/{id}` - Update policy
- `DELETE /v1/policies/{id}` - Delete policy
- `POST /v1/policies/export` - Export policies
- `POST /v1/policies/import` - Import policies
- `POST /v1/policies/backup` - Create backup
- `POST /v1/policies/restore` - Restore from backup

#### Principals
- `GET /v1/principals/{id}` - Get principal
- `POST /v1/principals/{id}` - Create principal
- `PUT /v1/principals/{id}` - Update principal
- `DELETE /v1/principals/{id}` - Delete principal

## Quick Start

### 1. Check Authorization

```bash
curl -X POST http://localhost:8080/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user123",
      "roles": ["developer"]
    },
    "action": "read",
    "resource": {
      "kind": "document",
      "id": "doc456"
    }
  }'
```

### 2. List Policies

```bash
curl -X GET "http://localhost:8080/v1/policies?page=1&page_size=20" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 3. Create Policy

```bash
curl -X POST http://localhost:8080/v1/policies \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "policy-dev-write-docs",
    "version": "1.0",
    "description": "Developers can write documentation",
    "resource_policy": {
      "resource": "document",
      "version": "1.0",
      "rules": [
        {
          "actions": ["write", "update"],
          "effect": "EFFECT_ALLOW",
          "roles": ["developer"]
        }
      ]
    }
  }'
```

### 4. Export Policies

```bash
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "include_metadata": true
  }' > policies-export.json
```

## Documentation

### Comprehensive Guides
- [REST API Guide](../docs/REST_API_GUIDE.md) - Complete API documentation (2000+ lines)
- [Policy Export/Import Guide](../docs/POLICY_EXPORT_IMPORT.md) - Migration and backup guide (1000+ lines)
- [API Examples](../docs/API_EXAMPLES.md) - Code examples in multiple languages (500+ lines)

### Collections
- [Postman Collection](../docs/POSTMAN_COLLECTION.json) - Ready to import

### Tools
- [Client Generator Script](../scripts/generate-clients.sh) - Generate SDKs

## Development

### Validate OpenAPI Spec

```bash
# Using Swagger CLI
npx @apidevtools/swagger-cli validate openapi.yaml

# Using OpenAPI Generator
openapi-generator-cli validate -i openapi.yaml
```

### Update Specification

When updating the OpenAPI spec:

1. Edit `openapi.yaml`
2. Validate the spec
3. Test with Swagger UI
4. Regenerate client SDKs
5. Update documentation
6. Commit changes

### Best Practices

1. **Versioning**: Always include version in paths (`/v1/...`)
2. **Examples**: Include examples for all operations
3. **Descriptions**: Write clear descriptions for all fields
4. **Error Responses**: Document all possible error codes
5. **Rate Limiting**: Document rate limits and headers
6. **Authentication**: Clearly document authentication requirements

## Support

- **API Documentation**: https://docs.authz-engine.example.com
- **Interactive Docs**: https://api.authz-engine.example.com/api-docs
- **GitHub Issues**: https://github.com/authz-engine/go-core/issues
- **Email**: support@authz-engine.example.com

---

**Version**: 1.0.0
**OpenAPI Version**: 3.0.3
**Last Updated**: 2025-01-27
