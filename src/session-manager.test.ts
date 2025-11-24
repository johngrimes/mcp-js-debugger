/**
 * Tests for Session Manager.
 *
 * @author John Grimes
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {SessionManager} from './session-manager.js';
import {SessionState} from './types.js';

// Mock uuid.
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-session-id'),
}));

// Create mock instances that will be returned by the mocked constructors.
const eventHandlers: Record<string, (params?: unknown) => void> = {};

const mockCdpClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn().mockReturnValue(true),
  on: vi.fn((event: string, handler: (params?: unknown) => void) => {
    eventHandlers[event] = handler;
  }),
  setBreakpointByUrl: vi.fn().mockResolvedValue({
    breakpointId: 'bp-123',
    locations: [{scriptId: 'script-1', lineNumber: 10, columnNumber: 0}],
  }),
  removeBreakpoint: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  stepOver: vi.fn().mockResolvedValue(undefined),
  stepInto: vi.fn().mockResolvedValue(undefined),
  stepOut: vi.fn().mockResolvedValue(undefined),
  runIfWaitingForDebugger: vi.fn().mockResolvedValue(undefined),
  evaluateOnCallFrame: vi.fn().mockResolvedValue({
    result: {type: 'number', value: 42},
  }),
  evaluate: vi.fn().mockResolvedValue({
    result: {type: 'string', value: 'hello'},
  }),
  getProperties: vi.fn().mockResolvedValue({
    result: [{name: 'x', value: {type: 'number', value: 1}}],
  }),
  setVariableValue: vi.fn().mockResolvedValue(undefined),
  setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
  getScriptSource: vi.fn().mockResolvedValue({scriptSource: 'console.log("test");'}),
  getScript: vi.fn().mockReturnValue({
    scriptId: 'script-1',
    url: 'file:///test.js',
    sourceMapUrl: undefined,
    startLine: 0,
    startColumn: 0,
    endLine: 100,
    endColumn: 0,
    hash: 'abc123',
  }),
  getAllScripts: vi.fn().mockReturnValue([
    {
      scriptId: 'script-1',
      url: 'file:///test.js',
      sourceMapUrl: undefined,
      startLine: 0,
      startColumn: 0,
      endLine: 100,
      endColumn: 0,
      hash: 'abc123',
    },
    {
      scriptId: 'script-2',
      url: 'node:internal/test',
      sourceMapUrl: undefined,
      startLine: 0,
      startColumn: 0,
      endLine: 50,
      endColumn: 0,
      hash: 'def456',
    },
  ]),
};

const mockSourceMapManager = {
  loadSourceMap: vi.fn().mockResolvedValue(true),
  loadInlineSourceMap: vi.fn().mockResolvedValue(true),
  hasSourceMap: vi.fn().mockReturnValue(false),
  getOriginalLocation: vi.fn().mockReturnValue(null),
  getGeneratedLocation: vi.fn().mockReturnValue(null),
  getOriginalSource: vi.fn().mockReturnValue(null),
  getOriginalSources: vi.fn().mockReturnValue(undefined),
  getSourceMapUrl: vi.fn().mockReturnValue(undefined),
  removeSourceMap: vi.fn(),
  clear: vi.fn(),
};

// Helper to trigger events on the mock client.
const triggerEvent = (event: string, params?: unknown) => {
  eventHandlers[event]?.(params);
};

// Mock CDPClient class.
vi.mock('./cdp-client.js', () => ({
  CDPClient: function CDPClient() {
    return mockCdpClient;
  },
}));

// Mock SourceMapManager class.
vi.mock('./source-map-manager.js', () => ({
  SourceMapManager: function SourceMapManager() {
    return mockSourceMapManager;
  },
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset event handlers.
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key]);
    // Reset mock return values.
    mockCdpClient.connect.mockResolvedValue(undefined);
    mockCdpClient.evaluateOnCallFrame.mockResolvedValue({
      result: {type: 'number', value: 42},
    });
    mockSourceMapManager.hasSourceMap.mockReturnValue(false);
    mockSourceMapManager.getOriginalLocation.mockReturnValue(null);
    mockSourceMapManager.getOriginalSources.mockReturnValue(undefined);
    mockSourceMapManager.getOriginalSource.mockReturnValue(null);
    mockCdpClient.getScript.mockReturnValue({
      scriptId: 'script-1',
      url: 'file:///test.js',
      sourceMapUrl: undefined,
      startLine: 0,
      startColumn: 0,
      endLine: 100,
      endColumn: 0,
      hash: 'abc123',
    });

    manager = new SessionManager();
  });

  describe('createSession', () => {
    it('should create a new session and return session ID', async () => {
      const sessionId = await manager.createSession(
        'ws://localhost:9229/test',
        'Test Session'
      );

      expect(sessionId).toBe('test-session-id');
      expect(mockCdpClient.connect).toHaveBeenCalledWith('ws://localhost:9229/test');
    });

    it('should emit sessionCreated event', async () => {
      const handler = vi.fn();
      manager.on('sessionCreated', handler);

      await manager.createSession('ws://localhost:9229/test');

      expect(handler).toHaveBeenCalledWith('test-session-id');
    });

    it('should throw CONNECTION_FAILED on connection error', async () => {
      mockCdpClient.connect.mockRejectedValue(new Error('Connection refused'));

      await expect(
        manager.createSession('ws://localhost:9229/invalid')
      ).rejects.toThrow('Failed to connect');
    });
  });

  describe('destroySession', () => {
    it('should destroy an existing session', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      await manager.destroySession(sessionId);

      expect(mockCdpClient.close).toHaveBeenCalled();
      expect(mockSourceMapManager.clear).toHaveBeenCalled();
    });

    it('should emit sessionDestroyed event', async () => {
      const handler = vi.fn();
      manager.on('sessionDestroyed', handler);
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      await manager.destroySession(sessionId);

      expect(handler).toHaveBeenCalledWith(sessionId);
    });

    it('should throw SESSION_NOT_FOUND for unknown session', async () => {
      await expect(manager.destroySession('unknown')).rejects.toThrow(
        'Session unknown not found'
      );
    });

    it('should handle close errors gracefully', async () => {
      mockCdpClient.close.mockRejectedValue(new Error('Close failed'));
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      // Should not throw.
      await expect(manager.destroySession(sessionId)).resolves.toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('should return empty list when no sessions', () => {
      const sessions = manager.listSessions();

      expect(sessions).toEqual([]);
    });

    it('should return list of session summaries', async () => {
      await manager.createSession('ws://localhost:9229/test', 'Test Session');

      const sessions = manager.listSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: 'test-session-id',
        name: 'Test Session',
        targetUrl: 'ws://localhost:9229/test',
        state: SessionState.CONNECTED,
      });
    });

    it('should include pause info when paused', async () => {
      await manager.createSession('ws://localhost:9229/test', 'Test Session');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [],
            this: {type: 'object'},
          },
        ],
      });

      const sessions = manager.listSessions();

      expect(sessions[0].pauseReason).toBe('breakpoint');
      expect(sessions[0].scriptUrl).toBe('file:///test.js');
      expect(sessions[0].lineNumber).toBe(10);
    });
  });

  describe('getSessionDetails', () => {
    it('should return detailed session information', async () => {
      const sessionId = await manager.createSession(
        'ws://localhost:9229/test',
        'Test Session'
      );

      const details = manager.getSessionDetails(sessionId);

      expect(details).toMatchObject({
        id: sessionId,
        name: 'Test Session',
        targetUrl: 'ws://localhost:9229/test',
        state: SessionState.CONNECTED,
        breakpoints: [],
      });
    });

    it('should throw for unknown session', () => {
      expect(() => manager.getSessionDetails('unknown')).toThrow(
        'Session unknown not found'
      );
    });

    it('should include call stack when paused', async () => {
      mockSourceMapManager.getOriginalLocation.mockReturnValue({
        source: 'src/app.ts',
        line: 5,
        column: 0,
        name: 'test',
      });
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [],
            this: {type: 'object'},
          },
        ],
      });

      const details = manager.getSessionDetails(sessionId);

      expect(details.pauseReason).toBe('breakpoint');
      expect(details.callStack).toHaveLength(1);
    });
  });

  describe('setBreakpoint', () => {
    it('should set a breakpoint and return breakpoint info', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const breakpoint = await manager.setBreakpoint(
        sessionId,
        'file:///test.js',
        10,
        0,
        'x > 5'
      );

      expect(breakpoint).toMatchObject({
        id: 'bp-123',
        url: 'file:///test.js',
        lineNumber: 10,
        columnNumber: 0,
        condition: 'x > 5',
        enabled: true,
      });
    });
  });

  describe('removeBreakpoint', () => {
    it('should remove an existing breakpoint', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      await manager.setBreakpoint(sessionId, 'file:///test.js', 10);

      await manager.removeBreakpoint(sessionId, 'bp-123');

      expect(mockCdpClient.removeBreakpoint).toHaveBeenCalledWith('bp-123');
    });

    it('should throw BREAKPOINT_NOT_FOUND for unknown breakpoint', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      await expect(
        manager.removeBreakpoint(sessionId, 'unknown-bp')
      ).rejects.toThrow('Breakpoint unknown-bp not found');
    });
  });

  describe('listBreakpoints', () => {
    it('should return empty list when no breakpoints', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const breakpoints = manager.listBreakpoints(sessionId);

      expect(breakpoints).toEqual([]);
    });

    it('should return list of breakpoints', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      await manager.setBreakpoint(sessionId, 'file:///test.js', 10);

      const breakpoints = manager.listBreakpoints(sessionId);

      expect(breakpoints).toHaveLength(1);
      expect(breakpoints[0].id).toBe('bp-123');
    });
  });

  describe('execution control', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await manager.createSession('ws://localhost:9229/test');
      // Simulate paused state.
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
        hitBreakpoints: ['bp-123'],
      });
    });

    describe('resume', () => {
      it('should resume execution when paused', async () => {
        await manager.resume(sessionId);

        expect(mockCdpClient.resume).toHaveBeenCalled();
      });

      it('should call runIfWaitingForDebugger when in CONNECTED state', async () => {
        // Create a new manager and session that stays in CONNECTED state.
        const freshManager = new SessionManager();
        const freshSessionId = await freshManager.createSession(
          'ws://localhost:9229/test'
        );
        // Don't trigger paused event - session remains in CONNECTED state.

        await freshManager.resume(freshSessionId);

        expect(mockCdpClient.runIfWaitingForDebugger).toHaveBeenCalled();
      });

      it('should throw when running', async () => {
        // Simulate resumed state.
        triggerEvent('resumed');

        await expect(manager.resume(sessionId)).rejects.toThrow(
          'is not paused or waiting for debugger'
        );
      });
    });

    describe('pause', () => {
      it('should pause execution when running', async () => {
        // First resume to get to running state.
        triggerEvent('resumed');

        await manager.pause(sessionId);

        expect(mockCdpClient.pause).toHaveBeenCalled();
      });

      it('should throw when already paused', async () => {
        await expect(manager.pause(sessionId)).rejects.toThrow('is not running');
      });
    });

    describe('stepOver', () => {
      it('should step over when paused', async () => {
        await manager.stepOver(sessionId);

        expect(mockCdpClient.stepOver).toHaveBeenCalled();
      });
    });

    describe('stepInto', () => {
      it('should step into when paused', async () => {
        await manager.stepInto(sessionId);

        expect(mockCdpClient.stepInto).toHaveBeenCalled();
      });
    });

    describe('stepOut', () => {
      it('should step out when paused', async () => {
        await manager.stepOut(sessionId);

        expect(mockCdpClient.stepOut).toHaveBeenCalled();
      });
    });
  });

  describe('getCallStack', () => {
    it('should return enriched call frames when paused', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      const {callFrames} = manager.getCallStack(sessionId);

      expect(callFrames).toHaveLength(1);
      expect(callFrames[0]).toMatchObject({
        callFrameId: 'frame-1',
        functionName: 'test',
        generatedLocation: {
          scriptId: 'script-1',
          lineNumber: 10,
          columnNumber: 0,
        },
      });
    });

    it('should include original location when source map available', async () => {
      mockSourceMapManager.getOriginalLocation.mockReturnValue({
        source: 'src/app.ts',
        line: 5,
        column: 2,
        name: 'originalTest',
      });

      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      const {callFrames} = manager.getCallStack(sessionId);

      expect(callFrames[0].originalLocation).toMatchObject({
        sourceUrl: 'src/app.ts',
        lineNumber: 5,
        columnNumber: 2,
      });
    });

    it('should include async stack trace when requested', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [],
            this: {type: 'object'},
          },
        ],
        asyncStackTrace: {description: 'Promise.then'},
      });

      const {asyncStackTrace} = manager.getCallStack(sessionId, true);

      expect(asyncStackTrace?.description).toBe('Promise.then');
    });

    it('should exclude async stack trace when not requested', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [],
            this: {type: 'object'},
          },
        ],
        asyncStackTrace: {description: 'Promise.then'},
      });

      const {asyncStackTrace} = manager.getCallStack(sessionId, false);

      expect(asyncStackTrace).toBeUndefined();
    });
  });

  describe('evaluate', () => {
    it('should evaluate expression in global context', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = await manager.evaluate(sessionId, '1 + 1');

      expect(result.result.value).toBe('hello');
      expect(mockCdpClient.evaluate).toHaveBeenCalled();
    });

    it('should evaluate expression on call frame when paused', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      const result = await manager.evaluate(sessionId, 'x', 'frame-1');

      expect(result.result.value).toBe(42);
      expect(mockCdpClient.evaluateOnCallFrame).toHaveBeenCalledWith(
        'frame-1',
        'x',
        true
      );
    });
  });

  describe('getScopeVariables', () => {
    it('should return scope variables when paused', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      const variables = await manager.getScopeVariables(sessionId, 'frame-1', 0);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('x');
    });

    it('should throw for invalid call frame', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      await expect(
        manager.getScopeVariables(sessionId, 'invalid-frame', 0)
      ).rejects.toThrow('Call frame invalid-frame not found');
    });

    it('should throw for invalid scope index', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      await expect(
        manager.getScopeVariables(sessionId, 'frame-1', 99)
      ).rejects.toThrow('Scope at index 99 not found');
    });
  });

  describe('setVariableValue', () => {
    it('should set variable value when paused', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      await manager.setVariableValue(sessionId, 'frame-1', 0, 'x', '100');

      expect(mockCdpClient.setVariableValue).toHaveBeenCalled();
    });

    it('should handle objectId in result', async () => {
      mockCdpClient.evaluateOnCallFrame.mockResolvedValue({
        result: {type: 'object', objectId: 'obj-123'},
      });

      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      await manager.setVariableValue(sessionId, 'frame-1', 0, 'x', '{a: 1}');

      expect(mockCdpClient.setVariableValue).toHaveBeenCalledWith(
        0,
        'x',
        {objectId: 'obj-123'},
        'frame-1'
      );
    });

    it('should handle unserializableValue in result', async () => {
      mockCdpClient.evaluateOnCallFrame.mockResolvedValue({
        result: {type: 'number', unserializableValue: 'Infinity'},
      });

      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      await manager.setVariableValue(sessionId, 'frame-1', 0, 'x', 'Infinity');

      expect(mockCdpClient.setVariableValue).toHaveBeenCalledWith(
        0,
        'x',
        {unserializableValue: 'Infinity'},
        'frame-1'
      );
    });

    it('should throw when evaluation fails', async () => {
      mockCdpClient.evaluateOnCallFrame.mockResolvedValue({
        result: {},
        exceptionDetails: {text: 'ReferenceError: invalid is not defined'},
      });

      const sessionId = await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'test',
            location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
            this: {type: 'object'},
          },
        ],
      });

      await expect(
        manager.setVariableValue(sessionId, 'frame-1', 0, 'x', 'invalid')
      ).rejects.toThrow('Failed to evaluate new value');
    });
  });

  describe('setPauseOnExceptions', () => {
    it('should set pause on exceptions mode', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      await manager.setPauseOnExceptions(sessionId, 'all');

      expect(mockCdpClient.setPauseOnExceptions).toHaveBeenCalledWith('all');
    });
  });

  describe('getOriginalLocation', () => {
    it('should return hasSourceMap false when no source map', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = manager.getOriginalLocation(sessionId, 'script-1', 10, 0);

      expect(result).toEqual({hasSourceMap: false});
    });

    it('should return original location when source map available', async () => {
      mockSourceMapManager.hasSourceMap.mockReturnValue(true);
      mockSourceMapManager.getOriginalLocation.mockReturnValue({
        source: 'src/app.ts',
        line: 5,
        column: 2,
        name: 'test',
      });

      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = manager.getOriginalLocation(sessionId, 'script-1', 10, 0);

      expect(result).toMatchObject({
        hasSourceMap: true,
        original: {
          sourceUrl: 'src/app.ts',
          lineNumber: 5,
          columnNumber: 2,
        },
      });
    });

    it('should return hasSourceMap true but no original when mapping fails', async () => {
      mockSourceMapManager.hasSourceMap.mockReturnValue(true);
      mockSourceMapManager.getOriginalLocation.mockReturnValue(null);

      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = manager.getOriginalLocation(sessionId, 'script-1', 10, 0);

      expect(result).toEqual({hasSourceMap: true});
    });
  });

  describe('getScriptSource', () => {
    it('should return generated source when no source map', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = await manager.getScriptSource(sessionId, 'script-1');

      expect(result).toMatchObject({
        source: 'console.log("test");',
        sourceUrl: 'file:///test.js',
        isOriginal: false,
      });
    });

    it('should return original source when source map available', async () => {
      mockSourceMapManager.hasSourceMap.mockReturnValue(true);
      mockSourceMapManager.getOriginalSources.mockReturnValue(['src/app.ts']);
      mockSourceMapManager.getOriginalSource.mockReturnValue('const x = 1;');
      mockSourceMapManager.getSourceMapUrl.mockReturnValue('app.js.map');

      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = await manager.getScriptSource(sessionId, 'script-1', true);

      expect(result).toMatchObject({
        source: 'const x = 1;',
        sourceUrl: 'src/app.ts',
        isOriginal: true,
        sourceMapUrl: 'app.js.map',
      });
    });

    it('should fall back to generated when original source not found', async () => {
      mockSourceMapManager.hasSourceMap.mockReturnValue(true);
      mockSourceMapManager.getOriginalSources.mockReturnValue(['src/app.ts']);
      mockSourceMapManager.getOriginalSource.mockReturnValue(null);

      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const result = await manager.getScriptSource(sessionId, 'script-1', true);

      expect(result.isOriginal).toBe(false);
    });

    it('should throw for unknown script', async () => {
      mockCdpClient.getScript.mockReturnValue(undefined);

      const sessionId = await manager.createSession('ws://localhost:9229/test');

      await expect(
        manager.getScriptSource(sessionId, 'unknown-script')
      ).rejects.toThrow('Script unknown-script not found');
    });
  });

  describe('listScripts', () => {
    it('should list non-internal scripts by default', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const scripts = manager.listScripts(sessionId);

      expect(scripts).toHaveLength(1);
      expect(scripts[0].url).toBe('file:///test.js');
    });

    it('should include internal scripts when requested', async () => {
      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const scripts = manager.listScripts(sessionId, true);

      expect(scripts).toHaveLength(2);
    });

    it('should filter out empty URL scripts', async () => {
      mockCdpClient.getAllScripts.mockReturnValue([
        {
          scriptId: 'script-1',
          url: 'file:///test.js',
          sourceMapUrl: undefined,
          startLine: 0,
          startColumn: 0,
          endLine: 100,
          endColumn: 0,
          hash: 'abc123',
        },
        {
          scriptId: 'script-empty',
          url: '',
          sourceMapUrl: undefined,
          startLine: 0,
          startColumn: 0,
          endLine: 10,
          endColumn: 0,
          hash: 'xyz789',
        },
      ]);

      const sessionId = await manager.createSession('ws://localhost:9229/test');

      const scripts = manager.listScripts(sessionId);

      expect(scripts).toHaveLength(1);
    });
  });

  describe('event handlers', () => {
    it('should handle scriptParsed event', async () => {
      const handler = vi.fn();
      manager.on('scriptParsed', handler);

      await manager.createSession('ws://localhost:9229/test');
      triggerEvent('scriptParsed', {
        scriptId: 'script-new',
        url: 'file:///new.js',
        startLine: 0,
        startColumn: 0,
        endLine: 10,
        endColumn: 0,
        hash: 'xyz',
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should handle breakpointResolved event', async () => {
      const handler = vi.fn();
      manager.on('breakpointResolved', handler);

      const sessionId = await manager.createSession('ws://localhost:9229/test');
      await manager.setBreakpoint(sessionId, 'file:///test.js', 10);

      triggerEvent('breakpointResolved', {
        breakpointId: 'bp-123',
        location: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should handle disconnected event', async () => {
      await manager.createSession('ws://localhost:9229/test');

      triggerEvent('disconnected');

      const sessions = manager.listSessions();
      expect(sessions[0].state).toBe(SessionState.DISCONNECTED);
    });

    it('should handle executionPaused event', async () => {
      const handler = vi.fn();
      manager.on('executionPaused', handler);

      await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {
        reason: 'breakpoint',
        callFrames: [],
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should handle executionResumed event', async () => {
      const handler = vi.fn();
      manager.on('executionResumed', handler);

      await manager.createSession('ws://localhost:9229/test');
      triggerEvent('paused', {reason: 'breakpoint', callFrames: []});
      triggerEvent('resumed');

      expect(handler).toHaveBeenCalled();
    });
  });
});
