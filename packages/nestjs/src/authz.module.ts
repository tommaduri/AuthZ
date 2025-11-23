import { Module, DynamicModule, Global, Provider, Type } from '@nestjs/common';
import type { AuthzClientConfig } from '@authz-engine/sdk';
import { createClient } from '@authz-engine/sdk';
import { AuthzService } from './authz.service';
import { AuthzGuard } from './authz.guard';
import { AuthzAgenticService, AuthzAgenticConfig, AUTHZ_AGENTIC_CONFIG } from './authz-agentic.service';

/**
 * Module configuration options
 */
export interface AuthzModuleOptions extends AuthzClientConfig {
  /** Make the module global (available everywhere without importing) */
  global?: boolean;
  /** Agentic service configuration */
  agentic?: AuthzAgenticConfig;
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
  useFactory: (...args: any[]) => Promise<AuthzModuleOptions> | AuthzModuleOptions;
  /** Dependencies to inject into factory */
  inject?: any[];
  /** Class that implements options factory */
  useClass?: Type<AuthzOptionsFactory>;
  /** Existing instance to use */
  useExisting?: Type<AuthzOptionsFactory>;
}

/**
 * Factory interface for creating options
 */
export interface AuthzOptionsFactory {
  createAuthzOptions(): Promise<AuthzModuleOptions> | AuthzModuleOptions;
}

export const AUTHZ_CLIENT = 'AUTHZ_CLIENT';
export const AUTHZ_OPTIONS = 'AUTHZ_OPTIONS';
export const AUTHZ_AGENTIC_SERVICE = 'AUTHZ_AGENTIC_SERVICE';

/**
 * AuthZ Module for NestJS
 *
 * Provides authorization capabilities via decorators and guards.
 * Supports both standard and agentic authorization features.
 *
 * @example Basic usage
 * ```typescript
 * @Module({
 *   imports: [
 *     AuthzModule.forRoot({
 *       serverUrl: 'http://localhost:3001',
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example With agentic features
 * ```typescript
 * @Module({
 *   imports: [
 *     AuthzModule.forRoot({
 *       serverUrl: 'http://localhost:3001',
 *       agentic: {
 *         enabled: true,
 *         orchestrator: {
 *           agents: { enabled: true },
 *         },
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example Async configuration
 * ```typescript
 * @Module({
 *   imports: [
 *     AuthzModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: (config: ConfigService) => ({
 *         serverUrl: config.get('AUTHZ_SERVER_URL'),
 *         agentic: {
 *           enabled: config.get('AUTHZ_AGENTIC_ENABLED') === 'true',
 *         },
 *       }),
 *       inject: [ConfigService],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
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

    const providers: Provider[] = [
      clientProvider,
      optionsProvider,
      AuthzService,
      AuthzGuard,
    ];

    const exports: (string | Type<any>)[] = [
      AuthzService,
      AuthzGuard,
      AUTHZ_CLIENT,
    ];

    // Add agentic service if enabled
    if (options.agentic?.enabled) {
      const agenticConfigProvider: Provider = {
        provide: AUTHZ_AGENTIC_CONFIG,
        useValue: options.agentic,
      };

      const agenticServiceProvider: Provider = {
        provide: AUTHZ_AGENTIC_SERVICE,
        useClass: AuthzAgenticService,
      };

      providers.push(agenticConfigProvider, agenticServiceProvider, AuthzAgenticService);
      exports.push(AuthzAgenticService, AUTHZ_AGENTIC_SERVICE);
    }

    return {
      module: AuthzModule,
      global: options.global ?? true,
      providers,
      exports,
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

    const agenticConfigProvider: Provider = {
      provide: AUTHZ_AGENTIC_CONFIG,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args);
        return config.agentic;
      },
      inject: options.inject || [],
    };

    const agenticServiceProvider: Provider = {
      provide: AUTHZ_AGENTIC_SERVICE,
      useClass: AuthzAgenticService,
    };

    return {
      module: AuthzModule,
      global: options.global ?? true,
      imports: options.imports || [],
      providers: [
        clientProvider,
        optionsProvider,
        agenticConfigProvider,
        agenticServiceProvider,
        AuthzService,
        AuthzGuard,
        AuthzAgenticService,
      ],
      exports: [
        AuthzService,
        AuthzGuard,
        AuthzAgenticService,
        AUTHZ_CLIENT,
        AUTHZ_AGENTIC_SERVICE,
      ],
    };
  }

  /**
   * Register only the agentic features (for use with existing AuthZ setup)
   */
  static forAgentic(config: AuthzAgenticConfig): DynamicModule {
    const agenticConfigProvider: Provider = {
      provide: AUTHZ_AGENTIC_CONFIG,
      useValue: config,
    };

    const agenticServiceProvider: Provider = {
      provide: AUTHZ_AGENTIC_SERVICE,
      useClass: AuthzAgenticService,
    };

    return {
      module: AuthzModule,
      global: true,
      providers: [agenticConfigProvider, agenticServiceProvider, AuthzAgenticService],
      exports: [AuthzAgenticService, AUTHZ_AGENTIC_SERVICE],
    };
  }

  /**
   * Register only the agentic features with async configuration
   */
  static forAgenticAsync(options: {
    imports?: any[];
    useFactory: (...args: any[]) => Promise<AuthzAgenticConfig> | AuthzAgenticConfig;
    inject?: any[];
  }): DynamicModule {
    const agenticConfigProvider: Provider = {
      provide: AUTHZ_AGENTIC_CONFIG,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const agenticServiceProvider: Provider = {
      provide: AUTHZ_AGENTIC_SERVICE,
      useClass: AuthzAgenticService,
    };

    return {
      module: AuthzModule,
      global: true,
      imports: options.imports || [],
      providers: [agenticConfigProvider, agenticServiceProvider, AuthzAgenticService],
      exports: [AuthzAgenticService, AUTHZ_AGENTIC_SERVICE],
    };
  }
}
