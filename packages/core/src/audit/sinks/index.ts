/**
 * Audit Sinks Index
 *
 * Re-exports all available audit sink implementations.
 */

export { ConsoleSink, createConsoleSink } from './console-sink';
export type { ConsoleSinkConfig } from './console-sink';

export { FileSink, createFileSink } from './file-sink';
export type { FileSinkConfig } from './file-sink';

export { HttpSink, createHttpSink } from './http-sink';
export type { HttpSinkConfig } from './http-sink';
