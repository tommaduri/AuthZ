import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import type { AuthzClientConfig } from '@authz-engine/sdk';
import { createClient } from '@authz-engine/sdk';
import { AuthzService } from './authz.service';
import { AuthzGuard } from './authz.guard';

/**
 * Module configuration options
 */
export interface AuthzModuleOptions extends AuthzClientConfig {
  /** Make the module global (available everywhere without importing) */
  global?: boolean;
}

/**
 * Async module configuration
 */
export interface AuthzModuleAsyncOptions {
  /** Make the module global */
  global?: boolean;
  /** Imports needed for the factory */
  imports?: any[];
  /** Factory function to create options */
  useFactory: (...args: any[]) => Promise<AuthzClientConfig> | AuthzClientConfig;
  /** Dependencies to inject into factory */
  inject?: any[];
}

export const AUTHZ_CLIENT = 'AUTHZ_CLIENT';
export const AUTHZ_OPTIONS = 'AUTHZ_OPTIONS';

/**
 * AuthZ Module for NestJS
 *
 * Provides authorization capabilities via decorators and guards.
 */
@Global()
@Module({})
export class AuthzModule {
  /**
   * Register with static configuration
   */
  static forRoot(options: AuthzModuleOptions): DynamicModule {
    const clientProvider: Provider = {
      provide: AUTHZ_CLIENT,
      useFactory: () => createClient(options),
    };

    const optionsProvider: Provider = {
      provide: AUTHZ_OPTIONS,
      useValue: options,
    };

    return {
      module: AuthzModule,
      global: options.global ?? true,
      providers: [clientProvider, optionsProvider, AuthzService, AuthzGuard],
      exports: [AuthzService, AuthzGuard, AUTHZ_CLIENT],
    };
  }

  /**
   * Register with async configuration (for using ConfigService, etc.)
   */
  static forRootAsync(options: AuthzModuleAsyncOptions): DynamicModule {
    const clientProvider: Provider = {
      provide: AUTHZ_CLIENT,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args);
        return createClient(config);
      },
      inject: options.inject || [],
    };

    const optionsProvider: Provider = {
      provide: AUTHZ_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    return {
      module: AuthzModule,
      global: options.global ?? true,
      imports: options.imports || [],
      providers: [clientProvider, optionsProvider, AuthzService, AuthzGuard],
      exports: [AuthzService, AuthzGuard, AUTHZ_CLIENT],
    };
  }
}
