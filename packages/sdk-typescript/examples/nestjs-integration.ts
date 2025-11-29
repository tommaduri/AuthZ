/**
 * NestJS Integration Examples
 *
 * This file demonstrates how to integrate the AuthZ Engine SDK with NestJS.
 */

/**
 * IMPORTANT: This is example code showing patterns and structure.
 *
 * To use this in a real NestJS application, you would need:
 * - @nestjs/core and @nestjs/common installed
 * - TypeScript with strict mode enabled
 * - Appropriate decorators and execution context available
 */

// ============================================================================
// Part 1: Service Setup
// ============================================================================

/**
 * AuthzService wraps the SDK client for use in NestJS
 */
export class AuthzService {
  // In a real implementation:
  // constructor(private readonly client: AuthzClient) {}
  //
  // For this example, we'll show the pattern:

  private readonly client: any; // Would be AuthzClient

  constructor() {
    // In a real app:
    // this.client = createClient(configService.get('authz'));
  }

  /**
   * Check if a principal can perform an action on a resource
   */
  async check(
    principalId: string,
    resourceKind: string,
    resourceId: string,
    actions: string[],
    attributes?: Record<string, unknown>
  ): Promise<boolean> {
    // Example implementation
    console.log(`AuthzService.check called for ${principalId}`);
    return true; // Placeholder
  }

  /**
   * Check a single action
   */
  async isAllowed(
    principalId: string,
    resourceKind: string,
    resourceId: string,
    action: string,
    attributes?: Record<string, unknown>
  ): Promise<boolean> {
    // Example implementation
    console.log(`AuthzService.isAllowed called for ${principalId}`);
    return true; // Placeholder
  }
}

// ============================================================================
// Part 2: Guard Implementation
// ============================================================================

/**
 * AuthzGuard - NestJS guard for authorization checks
 *
 * Usage:
 * @UseGuards(AuthzGuard)
 * @Require(['read', 'write'])
 * @Resource('document')
 * async handleRequest() { ... }
 */
export class AuthzGuard {
  // In a real implementation:
  // constructor(
  //   private readonly authzService: AuthzService,
  //   private readonly reflector: Reflector,
  // ) {}
  //
  // async canActivate(context: ExecutionContext): Promise<boolean> {
  //   const request = context.switchToHttp().getRequest();
  //   const requiredActions = this.reflector.get<string[]>(
  //     'authz:required-actions',
  //     context.getHandler(),
  //   );
  //   const resourceKind = this.reflector.get<string>(
  //     'authz:resource-kind',
  //     context.getHandler(),
  //   );
  //   const resourceId = this.reflector.get<string>(
  //     'authz:resource-id',
  //     context.getHandler(),
  //   ) || this.extractResourceId(request);
  //
  //   if (!requiredActions || !resourceKind) {
  //     return true; // No authorization required
  //   }
  //
  //   const result = await this.authzService.check(
  //     request.user.id,
  //     resourceKind,
  //     resourceId,
  //     requiredActions,
  //   );
  //
  //   if (!result) {
  //     throw new ForbiddenException('Authorization failed');
  //   }
  //
  //   return true;
  // }

  private extractResourceId(request: any): string {
    // Example: extract from route params
    return request.params.id;
  }
}

// ============================================================================
// Part 3: Decorators
// ============================================================================

/**
 * @Require decorator - specifies required actions
 *
 * Usage:
 * @Require(['read', 'write'])
 */
export function Require(actions: string[]): PropertyDecorator | MethodDecorator {
  // In a real implementation:
  // return SetMetadata('authz:required-actions', actions);
  return () => {}; // Placeholder
}

/**
 * @Resource decorator - specifies resource kind and ID
 *
 * Usage:
 * @Resource('document', 'id') // id from params
 * @Resource('folder')         // id extracted from request
 */
export function Resource(
  kind: string,
  idFrom?: string
): PropertyDecorator | MethodDecorator {
  // In a real implementation:
  // return (target, propertyKey, descriptor) => {
  //   SetMetadata('authz:resource-kind', kind)(target, propertyKey, descriptor);
  //   if (idFrom) {
  //     SetMetadata('authz:resource-id-from', idFrom)(
  //       target,
  //       propertyKey,
  //       descriptor,
  //     );
  //   }
  // };
  return () => {}; // Placeholder
}

/**
 * @AuthzCheck decorator - comprehensive authorization check
 *
 * Usage:
 * @AuthzCheck({
 *   resource: 'document',
 *   actions: ['read', 'write'],
 *   extractResourceId: (req) => req.params.id,
 * })
 */
export function AuthzCheck(options: {
  resource: string;
  actions: string[];
  extractResourceId?: (request: any) => string;
}): PropertyDecorator | MethodDecorator {
  // In a real implementation:
  // return (target, propertyKey, descriptor) => {
  //   SetMetadata('authz:check', options)(
  //     target,
  //     propertyKey,
  //     descriptor,
  //   );
  // };
  return () => {}; // Placeholder
}

// ============================================================================
// Part 4: Module Setup
// ============================================================================

/**
 * AuthzModule - NestJS module for AuthZ integration
 *
 * Usage in your app.module.ts:
 * @Module({
 *   imports: [
 *     AuthzModule.register({
 *       serverUrl: process.env.AUTHZ_SERVER_URL,
 *       timeout: 5000,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 */
export class AuthzModuleConfig {
  serverUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
  retry?: {
    maxRetries: number;
    backoffMs: number;
  };
}

// ============================================================================
// Part 5: Example Controller
// ============================================================================

/**
 * Example controller showing various authorization patterns
 *
 * In a real NestJS app, you would import necessary decorators:
 * import {
 *   Controller,
 *   Get,
 *   Post,
 *   Param,
 *   UseGuards,
 *   Request,
 * } from '@nestjs/common';
 */
export class DocumentController {
  /**
   * Get a document
   *
   * Requires:
   * - authenticated user
   * - 'read' permission on document resource
   *
   * Usage: GET /documents/:id
   */
  async getDocument(request: any): Promise<any> {
    // In a real implementation:
    // @Get(':id')
    // @AuthzCheck({
    //   resource: 'document',
    //   actions: ['read'],
    //   extractResourceId: (req) => req.params.id,
    // })
    // async getDocument(
    //   @Param('id') id: string,
    //   @Request() request: any,
    // ): Promise<any> {
    //   const document = await this.documentsService.findOne(id);
    //   return document;
    // }

    console.log('getDocument called');
    return { id: 'doc-1', title: 'Example' };
  }

  /**
   * Create a new document
   *
   * Requires:
   * - authenticated user
   * - 'create' permission on documents
   */
  async createDocument(request: any): Promise<any> {
    // In a real implementation:
    // @Post()
    // @Require(['create'])
    // @Resource('document')
    // async createDocument(
    //   @Body() createDocumentDto: CreateDocumentDto,
    //   @Request() request: any,
    // ): Promise<any> {
    //   const document = await this.documentsService.create(
    //     createDocumentDto,
    //     request.user,
    //   );
    //   return document;
    // }

    console.log('createDocument called');
    return { id: 'doc-2', title: 'New Document' };
  }

  /**
   * Update a document
   *
   * Requires:
   * - authenticated user
   * - 'write' permission on specific document
   */
  async updateDocument(
    id: string,
    request: any
  ): Promise<any> {
    // In a real implementation:
    // @Patch(':id')
    // @AuthzCheck({
    //   resource: 'document',
    //   actions: ['write'],
    //   extractResourceId: (req) => req.params.id,
    // })
    // async updateDocument(
    //   @Param('id') id: string,
    //   @Body() updateDocumentDto: UpdateDocumentDto,
    //   @Request() request: any,
    // ): Promise<any> {
    //   const document = await this.documentsService.update(
    //     id,
    //     updateDocumentDto,
    //   );
    //   return document;
    // }

    console.log(`updateDocument called for ${id}`);
    return { id, title: 'Updated' };
  }

  /**
   * Delete a document
   *
   * Requires:
   * - authenticated user
   * - 'delete' permission on specific document
   */
  async deleteDocument(
    id: string,
    request: any
  ): Promise<any> {
    // In a real implementation:
    // @Delete(':id')
    // @AuthzCheck({
    //   resource: 'document',
    //   actions: ['delete'],
    //   extractResourceId: (req) => req.params.id,
    // })
    // async deleteDocument(
    //   @Param('id') id: string,
    //   @Request() request: any,
    // ): Promise<any> {
    //   await this.documentsService.remove(id);
    //   return { success: true };
    // }

    console.log(`deleteDocument called for ${id}`);
    return { success: true };
  }

  /**
   * List documents
   *
   * This endpoint filters results based on what the user can read.
   * More complex authorization logic than simple allow/deny.
   */
  async listDocuments(request: any): Promise<any[]> {
    // In a real implementation, you would:
    // 1. Query for all documents
    // 2. Filter based on authorization for each document
    // 3. Or use PlanResources to generate a query filter

    // This is a simplified pattern:
    // @Get()
    // async listDocuments(
    //   @Request() request: any,
    //   @Query() query: ListDocumentsQuery,
    // ): Promise<DocumentDto[]> {
    //   const documents = await this.documentsService.findAll();
    //
    //   // Filter based on read permission
    //   const allowed: DocumentDto[] = [];
    //   for (const doc of documents) {
    //     const canRead = await this.authzService.isAllowed(
    //       request.user.id,
    //       'document',
    //       doc.id,
    //       'read',
    //     );
    //     if (canRead) {
    //       allowed.push(doc);
    //     }
    //   }
    //   return allowed;
    // }

    console.log('listDocuments called');
    return [
      { id: 'doc-1', title: 'Document 1' },
      { id: 'doc-2', title: 'Document 2' },
    ];
  }
}

// ============================================================================
// Part 6: Advanced Patterns
// ============================================================================

/**
 * Custom authorization logic for complex scenarios
 */
export class AdvancedAuthzService {
  async checkWithFallback(
    principalId: string,
    resourceKind: string,
    resourceId: string,
    action: string
  ): Promise<boolean> {
    // Pattern: Try primary authorization, fallback to custom logic
    // if service is unavailable

    try {
      // Primary check
      return true; // Result from authzService
    } catch (error) {
      // Fallback logic
      console.log('Using fallback authorization');

      // Example fallback: owner has all permissions
      const resource = await this.getResource(resourceKind, resourceId);
      if (resource.owner === principalId) {
        return true;
      }

      // Default: deny
      return false;
    }
  }

  private async getResource(
    kind: string,
    id: string
  ): Promise<{ owner: string }> {
    // Placeholder: would load actual resource
    return { owner: 'user123' };
  }

  async checkBulk(
    principalId: string,
    checks: Array<{
      resource: string;
      resourceId: string;
      action: string;
    }>
  ): Promise<Record<string, boolean>> {
    // Pattern: Efficient bulk authorization checks
    const results: Record<string, boolean> = {};

    // In real implementation:
    // const batchResult = await this.authzService.batchCheck(
    //   principalId,
    //   checks.map(c => ({
    //     resource: { kind: c.resource, id: c.resourceId, attributes: {} },
    //     actions: [c.action],
    //   })),
    // );

    for (const check of checks) {
      const key = `${check.resource}:${check.resourceId}:${check.action}`;
      results[key] = true; // Placeholder
    }

    return results;
  }
}

// ============================================================================
// Part 7: Configuration Example
// ============================================================================

/**
 * Example configuration for your .env file:
 *
 * AUTHZ_SERVER_URL=http://localhost:3000
 * AUTHZ_TIMEOUT=5000
 * AUTHZ_MAX_RETRIES=3
 * AUTHZ_BACKOFF_MS=100
 */

/**
 * Example configuration module:
 *
 * import { Module } from '@nestjs/common';
 * import { ConfigModule, ConfigService } from '@nestjs/config';
 *
 * @Module({
 *   imports: [ConfigModule.forRoot()],
 *   providers: [AuthzService],
 *   exports: [AuthzService],
 * })
 * export class AuthzConfigModule {
 *   constructor(
 *     private readonly configService: ConfigService,
 *   ) {}
 *
 *   getAuthzConfig() {
 *     return {
 *       serverUrl: this.configService.get('AUTHZ_SERVER_URL'),
 *       timeout: this.configService.get('AUTHZ_TIMEOUT', 5000),
 *       retry: {
 *         maxRetries: this.configService.get('AUTHZ_MAX_RETRIES', 3),
 *         backoffMs: this.configService.get('AUTHZ_BACKOFF_MS', 100),
 *       },
 *     };
 *   }
 * }
 */

/**
 * Usage in your app.module.ts:
 *
 * import { Module } from '@nestjs/common';
 * import { ConfigModule } from '@nestjs/config';
 * import { AuthzConfigModule } from './authz/authz-config.module';
 * import { DocumentController } from './documents/documents.controller';
 * import { DocumentsService } from './documents/documents.service';
 *
 * @Module({
 *   imports: [
 *     ConfigModule.forRoot(),
 *     AuthzConfigModule,
 *   ],
 *   controllers: [DocumentController],
 *   providers: [DocumentsService],
 * })
 * export class AppModule {}
 */

export const nestjsIntegrationDocumentation = `
NestJS Integration Guide
========================

1. Installation:
   npm install @authz-engine/sdk @nestjs/common @nestjs/core

2. Setup AuthzModule in your app.module.ts:
   @Module({
     imports: [
       AuthzModule.register({
         serverUrl: process.env.AUTHZ_SERVER_URL,
         timeout: 5000,
       }),
     ],
   })
   export class AppModule {}

3. Use in controllers:
   @Controller('documents')
   export class DocumentController {
     @Get(':id')
     @AuthzCheck({
       resource: 'document',
       actions: ['read'],
       extractResourceId: (req) => req.params.id,
     })
     async getDocument(
       @Param('id') id: string,
       @Request() request: any,
     ) {
       return this.documentsService.findOne(id);
     }
   }

4. For complex scenarios, inject AuthzService:
   constructor(private readonly authzService: AuthzService) {}

   async listDocuments() {
     const documents = await this.documentsService.findAll();
     // Filter by authorization
     return documents.filter(doc =>
       await this.authzService.isAllowed(
         request.user.id,
         'document',
         doc.id,
         'read',
       )
     );
   }
`;
