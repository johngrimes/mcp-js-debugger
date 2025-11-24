/*
 * Copyright 2025 John Grimes
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Type declarations for chrome-remote-interface.
 *
 * @author John Grimes
 */

declare module 'chrome-remote-interface' {
  import type {Protocol} from 'devtools-protocol';

  interface CDPOptions {
    host?: string;
    port?: number;
    target?: string;
  }

  interface DebuggerDomain {
    enable(params?: Protocol.Debugger.EnableRequest): Promise<Protocol.Debugger.EnableResponse>;
    setBreakpointByUrl(params: Protocol.Debugger.SetBreakpointByUrlRequest): Promise<Protocol.Debugger.SetBreakpointByUrlResponse>;
    removeBreakpoint(params: Protocol.Debugger.RemoveBreakpointRequest): Promise<void>;
    resume(params?: Protocol.Debugger.ResumeRequest): Promise<void>;
    pause(): Promise<void>;
    stepOver(params?: Protocol.Debugger.StepOverRequest): Promise<void>;
    stepInto(params?: Protocol.Debugger.StepIntoRequest): Promise<void>;
    stepOut(): Promise<void>;
    evaluateOnCallFrame(params: Protocol.Debugger.EvaluateOnCallFrameRequest): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse>;
    setVariableValue(params: Protocol.Debugger.SetVariableValueRequest): Promise<void>;
    setPauseOnExceptions(params: Protocol.Debugger.SetPauseOnExceptionsRequest): Promise<void>;
    getScriptSource(params: Protocol.Debugger.GetScriptSourceRequest): Promise<Protocol.Debugger.GetScriptSourceResponse>;
    paused(handler: (params: Protocol.Debugger.PausedEvent) => void): void;
    resumed(handler: () => void): void;
    scriptParsed(handler: (params: Protocol.Debugger.ScriptParsedEvent) => void): void;
    breakpointResolved(handler: (params: Protocol.Debugger.BreakpointResolvedEvent) => void): void;
  }

  interface RuntimeDomain {
    enable(): Promise<void>;
    evaluate(params: Protocol.Runtime.EvaluateRequest): Promise<Protocol.Runtime.EvaluateResponse>;
    getProperties(params: Protocol.Runtime.GetPropertiesRequest): Promise<Protocol.Runtime.GetPropertiesResponse>;
  }

  export interface Client {
    Debugger: DebuggerDomain;
    Runtime: RuntimeDomain;
    on(event: 'disconnect', handler: () => void): void;
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  export default CDP;
  export {CDP, Client};
}
