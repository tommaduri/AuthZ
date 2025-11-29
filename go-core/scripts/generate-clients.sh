#!/bin/bash

# Script to generate client SDKs from OpenAPI specification
# Requires: openapi-generator-cli (npm install -g @openapitools/openapi-generator-cli)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_SPEC="$PROJECT_ROOT/api/openapi.yaml"
CLIENTS_DIR="$PROJECT_ROOT/clients"

echo "=========================================="
echo "Authorization Engine - Client SDK Generator"
echo "=========================================="
echo ""

# Check if openapi-generator-cli is installed
if ! command -v openapi-generator-cli &> /dev/null; then
    echo "Error: openapi-generator-cli is not installed"
    echo "Install with: npm install -g @openapitools/openapi-generator-cli"
    exit 1
fi

# Check if API spec exists
if [ ! -f "$API_SPEC" ]; then
    echo "Error: OpenAPI spec not found at $API_SPEC"
    exit 1
fi

# Create clients directory
mkdir -p "$CLIENTS_DIR"

# Function to generate client
generate_client() {
    local generator=$1
    local output_dir=$2
    local package_name=$3
    local additional_properties=$4

    echo "Generating $generator client..."
    echo "  Output: $output_dir"

    openapi-generator-cli generate \
        -i "$API_SPEC" \
        -g "$generator" \
        -o "$output_dir" \
        --package-name "$package_name" \
        --additional-properties="$additional_properties" \
        --skip-validate-spec

    echo "✅ $generator client generated"
    echo ""
}

# Generate TypeScript/JavaScript client (axios)
echo "1. TypeScript/JavaScript Client (axios)"
generate_client \
    "typescript-axios" \
    "$CLIENTS_DIR/typescript" \
    "authz-engine-client" \
    "npmName=authz-engine-client,npmVersion=1.0.0,supportsES6=true"

# Generate Python client
echo "2. Python Client"
generate_client \
    "python" \
    "$CLIENTS_DIR/python" \
    "authz_engine_client" \
    "packageName=authz_engine_client,projectName=authz-engine-client,packageVersion=1.0.0"

# Generate Go client
echo "3. Go Client"
generate_client \
    "go" \
    "$CLIENTS_DIR/go" \
    "authzclient" \
    "packageName=authzclient,packageVersion=1.0.0"

# Generate Java client
echo "4. Java Client"
generate_client \
    "java" \
    "$CLIENTS_DIR/java" \
    "com.authzengine.client" \
    "groupId=com.authzengine,artifactId=authz-engine-client,artifactVersion=1.0.0"

# Generate CLI tool (Go)
echo "5. CLI Tool"
openapi-generator-cli generate \
    -i "$API_SPEC" \
    -g go \
    -o "$CLIENTS_DIR/cli" \
    --package-name authzcli \
    --additional-properties="packageName=authzcli,packageVersion=1.0.0" \
    --skip-validate-spec

echo "✅ CLI tool generated"
echo ""

# Create README for each client
create_readme() {
    local client_dir=$1
    local language=$2
    local package_name=$3

    cat > "$client_dir/README.md" <<EOF
# Authorization Engine $language Client

Auto-generated $language client SDK for the Authorization Engine REST API.

## Installation

$(case $language in
    TypeScript)
        echo "npm install authz-engine-client"
        ;;
    Python)
        echo "pip install authz-engine-client"
        ;;
    Go)
        echo "go get github.com/authz-engine/go-core/clients/go"
        ;;
    Java)
        echo "<!-- Maven -->
<dependency>
  <groupId>com.authzengine</groupId>
  <artifactId>authz-engine-client</artifactId>
  <version>1.0.0</version>
</dependency>"
        ;;
esac)

## Usage

See [API Examples](../../docs/API_EXAMPLES.md) for comprehensive usage examples.

### Quick Start

$(case $language in
    TypeScript)
        echo "\`\`\`typescript
import { Configuration, AuthorizationApi } from 'authz-engine-client';

const config = new Configuration({
  basePath: 'http://localhost:8080/v1',
  accessToken: 'your-jwt-token'
});

const api = new AuthorizationApi(config);

const result = await api.authorizationCheckPost({
  principal: {
    id: 'user123',
    roles: ['developer']
  },
  action: 'read',
  resource: {
    kind: 'document',
    id: 'doc456'
  }
});

console.log('Allowed:', result.allowed);
\`\`\`"
        ;;
    Python)
        echo "\`\`\`python
import authz_engine_client
from authz_engine_client.api import authorization_api
from authz_engine_client.model.authorization_check_request import AuthorizationCheckRequest

configuration = authz_engine_client.Configuration(
    host='http://localhost:8080/v1',
    access_token='your-jwt-token'
)

with authz_engine_client.ApiClient(configuration) as api_client:
    api = authorization_api.AuthorizationApi(api_client)

    request = AuthorizationCheckRequest(
        principal={'id': 'user123', 'roles': ['developer']},
        action='read',
        resource={'kind': 'document', 'id': 'doc456'}
    )

    result = api.authorization_check_post(request)
    print('Allowed:', result.allowed)
\`\`\`"
        ;;
    Go)
        echo "\`\`\`go
package main

import (
    \"context\"
    \"fmt\"
    authzclient \"github.com/authz-engine/go-core/clients/go\"
)

func main() {
    config := authzclient.NewConfiguration()
    config.Host = \"localhost:8080\"
    config.Scheme = \"http\"
    config.AddDefaultHeader(\"Authorization\", \"Bearer your-jwt-token\")

    client := authzclient.NewAPIClient(config)

    request := authzclient.AuthorizationCheckRequest{
        Principal: authzclient.Principal{
            Id:    \"user123\",
            Roles: []string{\"developer\"},
        },
        Action: \"read\",
        Resource: authzclient.Resource{
            Kind: \"document\",
            Id:   \"doc456\",
        },
    }

    result, _, err := client.AuthorizationApi.AuthorizationCheckPost(context.Background()).
        AuthorizationCheckRequest(request).
        Execute()

    if err != nil {
        fmt.Printf(\"Error: %v\\n\", err)
        return
    }

    fmt.Printf(\"Allowed: %v\\n\", result.Allowed)
}
\`\`\`"
        ;;
    Java)
        echo "\`\`\`java
import com.authzengine.client.ApiClient;
import com.authzengine.client.ApiException;
import com.authzengine.client.Configuration;
import com.authzengine.client.api.AuthorizationApi;
import com.authzengine.client.model.*;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath(\"http://localhost:8080/v1\");
        defaultClient.setBearerToken(\"your-jwt-token\");

        AuthorizationApi api = new AuthorizationApi(defaultClient);

        AuthorizationCheckRequest request = new AuthorizationCheckRequest();
        request.setPrincipal(new Principal()
            .id(\"user123\")
            .roles(Arrays.asList(\"developer\")));
        request.setAction(\"read\");
        request.setResource(new Resource()
            .kind(\"document\")
            .id(\"doc456\"));

        try {
            AuthorizationCheckResponse result = api.authorizationCheckPost(request);
            System.out.println(\"Allowed: \" + result.getAllowed());
        } catch (ApiException e) {
            System.err.println(\"Exception: \" + e.getMessage());
        }
    }
}
\`\`\`"
        ;;
esac)

## Documentation

- [API Reference](https://api.authz-engine.example.com/api-docs)
- [REST API Guide](../../docs/REST_API_GUIDE.md)
- [API Examples](../../docs/API_EXAMPLES.md)

## Support

- GitHub Issues: https://github.com/authz-engine/go-core/issues
- Documentation: https://docs.authz-engine.example.com

---

**Version**: 1.0.0
**Generated**: $(date +%Y-%m-%d)
EOF
}

echo "Creating README files..."
create_readme "$CLIENTS_DIR/typescript" "TypeScript" "authz-engine-client"
create_readme "$CLIENTS_DIR/python" "Python" "authz_engine_client"
create_readme "$CLIENTS_DIR/go" "Go" "authzclient"
create_readme "$CLIENTS_DIR/java" "Java" "com.authzengine.client"

# Create main clients README
cat > "$CLIENTS_DIR/README.md" <<EOF
# Authorization Engine Client SDKs

Auto-generated client SDKs for the Authorization Engine REST API.

## Available Clients

### TypeScript/JavaScript (axios)
**Location**: \`clients/typescript/\`
**Package**: \`authz-engine-client\`

### Python
**Location**: \`clients/python/\`
**Package**: \`authz-engine-client\`

### Go
**Location**: \`clients/go/\`
**Package**: \`github.com/authz-engine/go-core/clients/go\`

### Java
**Location**: \`clients/java/\`
**Package**: \`com.authzengine:authz-engine-client\`

### CLI Tool
**Location**: \`clients/cli/\`
**Binary**: \`authz-cli\`

## Regenerating Clients

To regenerate all clients from the OpenAPI specification:

\`\`\`bash
./scripts/generate-clients.sh
\`\`\`

## Requirements

- Node.js 16+ (for openapi-generator-cli)
- \`@openapitools/openapi-generator-cli\` installed globally

\`\`\`bash
npm install -g @openapitools/openapi-generator-cli
\`\`\`

## Documentation

- [OpenAPI Specification](../api/openapi.yaml)
- [REST API Guide](../docs/REST_API_GUIDE.md)
- [API Examples](../docs/API_EXAMPLES.md)

---

**Generated**: $(date +%Y-%m-%d)
EOF

echo "=========================================="
echo "✅ All clients generated successfully!"
echo "=========================================="
echo ""
echo "Generated clients:"
echo "  - TypeScript/JavaScript: $CLIENTS_DIR/typescript/"
echo "  - Python: $CLIENTS_DIR/python/"
echo "  - Go: $CLIENTS_DIR/go/"
echo "  - Java: $CLIENTS_DIR/java/"
echo "  - CLI: $CLIENTS_DIR/cli/"
echo ""
echo "Next steps:"
echo "  1. Review generated clients"
echo "  2. Test clients with examples from docs/API_EXAMPLES.md"
echo "  3. Publish to package registries (npm, PyPI, Maven, etc.)"
echo ""
