/**
 * Tests for CDP Client wrapper.
 *
 * @author John Grimes
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {CDPClient} from './cdp-client.js';

// Mock chrome-remote-interface.
vi.mock('chrome-remote-interface', () => {
  const mockDebugger = {
    enable: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stepOver: vi.fn().mockResolvedValue(undefined),
    stepInto: vi.fn().mockResolvedValue(undefined),
    stepOut: vi.fn().mockResolvedValue(undefined),
    setBreakpointByUrl: vi.fn().mockResolvedValue({
      breakpointId: 'bp-123',
      locations: [{scriptId: 'script-1', lineNumber: 10, columnNumber: 0}],
    }),
    removeBreakpoint: vi.fn().mockResolvedValue(undefined),
    evaluateOnCallFrame: vi.fn().mockResolvedValue({
      result: {type: 'number', value: 42},
    }),
    setVariableValue: vi.fn().mockResolvedValue(undefined),
    setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    getScriptSource: vi.fn().mockResolvedValue({scriptSource: 'console.log("test");'}),
    paused: vi.fn(),
    resumed: vi.fn(),
    scriptParsed: vi.fn(),
    breakpointResolved: vi.fn(),
  };

  const mockRuntime = {
    enable: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({result: {type: 'string', value: 'hello'}}),
    getProperties: vi.fn().mockResolvedValue({result: [{name: 'x', value: {type: 'number', value: 1}}]}),
    runIfWaitingForDebugger: vi.fn().mockResolvedValue(undefined),
  };

  const mockClient = {
    Debugger: mockDebugger,
    Runtime: mockRuntime,
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    default: vi.fn().mockResolvedValue(mockClient),
    __mockClient: mockClient,
    __mockDebugger: mockDebugger,
    __mockRuntime: mockRuntime,
  };
});

describe('CDPClient', () => {
  let cdpClient: CDPClient;

  beforeEach(() => {
    cdpClient = new CDPClient();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (cdpClient.isConnected()) {
      await cdpClient.close();
    }
  });

  describe('connect', () => {
    it('should connect to a CDP endpoint with a WebSocket URL', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      expect(cdpClient.isConnected()).toBe(true);
    });

    it('should connect to a CDP endpoint with host and port', async () => {
      await cdpClient.connect({host: 'localhost', port: 9229});

      expect(cdpClient.isConnected()).toBe(true);
    });

    it('should throw if already connected', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      await expect(cdpClient.connect('ws://localhost:9229/test')).rejects.toThrow(
        'Already connected'
      );
    });
  });

  describe('setBreakpointByUrl', () => {
    it('should set a breakpoint and return the response', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      const result = await cdpClient.setBreakpointByUrl(
        'file:///test.js',
        10,
        0,
        'x > 5'
      );

      expect(result.breakpointId).toBe('bp-123');
      expect(result.locations).toHaveLength(1);
    });

    it('should throw if not connected', async () => {
      await expect(
        cdpClient.setBreakpointByUrl('file:///test.js', 10)
      ).rejects.toThrow('Not connected to CDP endpoint');
    });
  });

  describe('removeBreakpoint', () => {
    it('should remove a breakpoint', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      await expect(cdpClient.removeBreakpoint('bp-123')).resolves.toBeUndefined();
    });

    it('should throw if not connected', async () => {
      await expect(cdpClient.removeBreakpoint('bp-123')).rejects.toThrow(
        'Not connected to CDP endpoint'
      );
    });
  });

  describe('execution control', () => {
    beforeEach(async () => {
      await cdpClient.connect('ws://localhost:9229/test');
    });

    it('should resume execution', async () => {
      await expect(cdpClient.resume()).resolves.toBeUndefined();
    });

    it('should pause execution', async () => {
      await expect(cdpClient.pause()).resolves.toBeUndefined();
    });

    it('should step over', async () => {
      await expect(cdpClient.stepOver()).resolves.toBeUndefined();
    });

    it('should step into', async () => {
      await expect(cdpClient.stepInto()).resolves.toBeUndefined();
    });

    it('should step out', async () => {
      await expect(cdpClient.stepOut()).resolves.toBeUndefined();
    });

    it('should run if waiting for debugger', async () => {
      await expect(cdpClient.runIfWaitingForDebugger()).resolves.toBeUndefined();
    });
  });

  describe('evaluateOnCallFrame', () => {
    it('should evaluate an expression on a call frame', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      const result = await cdpClient.evaluateOnCallFrame('frame-1', 'x + 1', true);

      expect(result.result.type).toBe('number');
      expect(result.result.value).toBe(42);
    });

    it('should throw if not connected', async () => {
      await expect(
        cdpClient.evaluateOnCallFrame('frame-1', 'x + 1')
      ).rejects.toThrow('Not connected to CDP endpoint');
    });
  });

  describe('evaluate', () => {
    it('should evaluate an expression in global context', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      const result = await cdpClient.evaluate('"hello"', true);

      expect(result.result.type).toBe('string');
      expect(result.result.value).toBe('hello');
    });
  });

  describe('getProperties', () => {
    it('should get properties of an object', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      const result = await cdpClient.getProperties('obj-1', true);

      expect(result.result).toHaveLength(1);
      expect(result.result[0].name).toBe('x');
    });
  });

  describe('setVariableValue', () => {
    it('should set a variable value', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      await expect(
        cdpClient.setVariableValue(0, 'x', {value: 10}, 'frame-1')
      ).resolves.toBeUndefined();
    });
  });

  describe('setPauseOnExceptions', () => {
    it('should set pause on exceptions mode', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      await expect(cdpClient.setPauseOnExceptions('all')).resolves.toBeUndefined();
    });
  });

  describe('getScriptSource', () => {
    it('should get the source of a script', async () => {
      await cdpClient.connect('ws://localhost:9229/test');

      const result = await cdpClient.getScriptSource('script-1');

      expect(result.scriptSource).toBe('console.log("test");');
    });
  });

  describe('script management', () => {
    it('should return undefined for unknown script', () => {
      expect(cdpClient.getScript('unknown')).toBeUndefined();
    });

    it('should return empty array when no scripts loaded', () => {
      expect(cdpClient.getAllScripts()).toEqual([]);
    });

    it('should find no scripts by URL pattern when empty', () => {
      expect(cdpClient.findScriptsByUrl('test')).toEqual([]);
    });
  });

  describe('event handlers', () => {
    it('should register event handlers', async () => {
      const pausedHandler = vi.fn();
      const resumedHandler = vi.fn();

      cdpClient.on('paused', pausedHandler);
      cdpClient.on('resumed', resumedHandler);

      // Handlers are stored; they will be called when events arrive.
      await cdpClient.connect('ws://localhost:9229/test');

      // Verify handlers were set (internal state).
      expect(pausedHandler).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close the connection', async () => {
      await cdpClient.connect('ws://localhost:9229/test');
      expect(cdpClient.isConnected()).toBe(true);

      await cdpClient.close();

      expect(cdpClient.isConnected()).toBe(false);
    });

    it('should handle closing when not connected', async () => {
      await expect(cdpClient.close()).resolves.toBeUndefined();
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(cdpClient.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      await cdpClient.connect('ws://localhost:9229/test');
      expect(cdpClient.isConnected()).toBe(true);
    });
  });
});
