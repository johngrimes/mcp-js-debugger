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
 * Tests for Source Map Manager.
 *
 * @author John Grimes
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {SourceMapManager} from './source-map-manager.js';
import type {ScriptInfo} from './types.js';

// Create a mock consumer instance that will be returned.
const createMockConsumer = () => ({
  sources: ['src/app.ts', 'src/utils.ts'],
  originalPositionFor: vi.fn().mockReturnValue({
    source: 'src/app.ts',
    line: 5,
    column: 10,
    name: 'myFunction',
  }),
  generatedPositionFor: vi.fn().mockReturnValue({
    line: 15,
    column: 20,
  }),
  sourceContentFor: vi.fn().mockReturnValue('const x = 1;'),
  destroy: vi.fn(),
});

// Mock source-map library with a class-based constructor.
vi.mock('source-map', () => {
  // Use a class that returns a promise when constructed (like the real SourceMapConsumer).
  class MockSourceMapConsumer {
    sources: string[];
    originalPositionFor: ReturnType<typeof vi.fn>;
    generatedPositionFor: ReturnType<typeof vi.fn>;
    sourceContentFor: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;

    constructor() {
      const mock = createMockConsumer();
      this.sources = mock.sources;
      this.originalPositionFor = mock.originalPositionFor;
      this.generatedPositionFor = mock.generatedPositionFor;
      this.sourceContentFor = mock.sourceContentFor;
      this.destroy = mock.destroy;

      // The real SourceMapConsumer returns a Promise from the constructor.
      // We simulate this by returning a Promise that resolves to `this`.
      return Promise.resolve(this) as unknown as MockSourceMapConsumer;
    }
  }

  return {
    SourceMapConsumer: MockSourceMapConsumer,
  };
});

describe('SourceMapManager', () => {
  let manager: SourceMapManager;

  beforeEach(() => {
    manager = new SourceMapManager();
  });

  // Helper to load a source map for tests that need it.
  const loadTestSourceMap = async () => {
    const sourceMapContent = JSON.stringify({
      version: 3,
      sources: ['src/app.ts'],
      mappings: 'AAAA',
    });
    const base64 = Buffer.from(sourceMapContent).toString('base64');
    await manager.loadInlineSourceMap(
      'script-1',
      `data:application/json;base64,${base64}`
    );
  };

  describe('loadSourceMap', () => {
    const scriptInfo: ScriptInfo = {
      scriptId: 'script-1',
      url: 'http://localhost:3000/dist/bundle.js',
      sourceMapUrl: 'bundle.js.map',
      startLine: 0,
      startColumn: 0,
      endLine: 100,
      endColumn: 0,
      hash: 'abc123',
    };

    it('should load a source map from a relative URL', async () => {
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({
          version: 3,
          sources: ['src/app.ts'],
          mappings: 'AAAA',
        })
      );

      const result = await manager.loadSourceMap(scriptInfo, fetchSourceMap);

      expect(result).toBe(true);
      expect(fetchSourceMap).toHaveBeenCalledWith(
        'http://localhost:3000/dist/bundle.js.map'
      );
      expect(manager.hasSourceMap('script-1')).toBe(true);
    });

    it('should load a source map from an absolute HTTP URL', async () => {
      const absoluteScriptInfo: ScriptInfo = {
        ...scriptInfo,
        sourceMapUrl: 'http://cdn.example.com/maps/bundle.js.map',
      };
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: [], mappings: ''})
      );

      const result = await manager.loadSourceMap(absoluteScriptInfo, fetchSourceMap);

      expect(result).toBe(true);
      expect(fetchSourceMap).toHaveBeenCalledWith(
        'http://cdn.example.com/maps/bundle.js.map'
      );
    });

    it('should load a source map from an absolute https URL', async () => {
      const httpsScriptInfo: ScriptInfo = {
        ...scriptInfo,
        sourceMapUrl: 'https://cdn.example.com/maps/bundle.js.map',
      };
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: [], mappings: ''})
      );

      const result = await manager.loadSourceMap(httpsScriptInfo, fetchSourceMap);

      expect(result).toBe(true);
      expect(fetchSourceMap).toHaveBeenCalledWith(
        'https://cdn.example.com/maps/bundle.js.map'
      );
    });

    it('should load a source map from an absolute file URL', async () => {
      const fileScriptInfo: ScriptInfo = {
        ...scriptInfo,
        sourceMapUrl: 'file:///path/to/bundle.js.map',
      };
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: [], mappings: ''})
      );

      const result = await manager.loadSourceMap(fileScriptInfo, fetchSourceMap);

      expect(result).toBe(true);
      expect(fetchSourceMap).toHaveBeenCalledWith('file:///path/to/bundle.js.map');
    });

    it('should return false if no source map URL', async () => {
      const noMapScriptInfo: ScriptInfo = {
        ...scriptInfo,
        sourceMapUrl: undefined,
      };
      const fetchSourceMap = vi.fn();

      const result = await manager.loadSourceMap(noMapScriptInfo, fetchSourceMap);

      expect(result).toBe(false);
      expect(fetchSourceMap).not.toHaveBeenCalled();
    });

    it('should return false if fetch returns null', async () => {
      const fetchSourceMap = vi.fn().mockResolvedValue(null);

      const result = await manager.loadSourceMap(scriptInfo, fetchSourceMap);

      expect(result).toBe(false);
    });

    it('should return false and log error on parse failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchSourceMap = vi.fn().mockResolvedValue('invalid json');

      const result = await manager.loadSourceMap(scriptInfo, fetchSourceMap);

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should resolve relative URLs when URL parsing fails', async () => {
      const badUrlScriptInfo: ScriptInfo = {
        ...scriptInfo,
        url: 'not-a-valid-url/bundle.js',
        sourceMapUrl: 'bundle.js.map',
      };
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: [], mappings: ''})
      );

      const result = await manager.loadSourceMap(badUrlScriptInfo, fetchSourceMap);

      expect(result).toBe(true);
      expect(fetchSourceMap).toHaveBeenCalledWith('not-a-valid-url/bundle.js.map');
    });

    it('should store source map URL after loading', async () => {
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: [], mappings: ''})
      );

      await manager.loadSourceMap(scriptInfo, fetchSourceMap);

      expect(manager.getSourceMapUrl('script-1')).toBe(
        'http://localhost:3000/dist/bundle.js.map'
      );
    });

    it('should store original sources after loading', async () => {
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: ['src/app.ts', 'src/utils.ts'], mappings: ''})
      );

      await manager.loadSourceMap(scriptInfo, fetchSourceMap);

      // The mock returns sources from the mock consumer.
      expect(manager.getOriginalSources('script-1')).toEqual(['src/app.ts', 'src/utils.ts']);
    });
  });

  describe('loadInlineSourceMap', () => {
    it('should load an inline base64 source map', async () => {
      const sourceMapContent = JSON.stringify({
        version: 3,
        sources: ['src/app.ts'],
        mappings: 'AAAA',
      });
      const base64 = Buffer.from(sourceMapContent).toString('base64');
      const dataUrl = `data:application/json;base64,${base64}`;

      const result = await manager.loadInlineSourceMap('script-1', dataUrl);

      expect(result).toBe(true);
      expect(manager.hasSourceMap('script-1')).toBe(true);
    });

    it('should load an inline base64 source map with charset', async () => {
      const sourceMapContent = JSON.stringify({
        version: 3,
        sources: ['src/app.ts'],
        mappings: 'AAAA',
      });
      const base64 = Buffer.from(sourceMapContent).toString('base64');
      const dataUrl = `data:application/json;charset=utf-8;base64,${base64}`;

      const result = await manager.loadInlineSourceMap('script-1', dataUrl);

      expect(result).toBe(true);
    });

    it('should return false for invalid data URL format', async () => {
      const result = await manager.loadInlineSourceMap(
        'script-1',
        'data:text/plain;base64,invalid'
      );

      expect(result).toBe(false);
    });

    it('should return false and log error on parse failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const invalidBase64 = Buffer.from('not json').toString('base64');
      const dataUrl = `data:application/json;base64,${invalidBase64}`;

      const result = await manager.loadInlineSourceMap('script-1', dataUrl);

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getOriginalLocation', () => {
    it('should return original location for a generated position', async () => {
      await loadTestSourceMap();

      const result = manager.getOriginalLocation('script-1', 15, 20);

      expect(result).toEqual({
        source: 'src/app.ts',
        line: 5,
        column: 10,
        name: 'myFunction',
      });
    });

    it('should return null if no source map for script', () => {
      const result = manager.getOriginalLocation('unknown-script', 15, 20);

      expect(result).toBeNull();
    });
  });

  describe('getGeneratedLocation', () => {
    it('should return generated location for an original position', async () => {
      await loadTestSourceMap();

      const result = manager.getGeneratedLocation('script-1', 'src/app.ts', 5, 10);

      expect(result).toEqual({
        line: 15,
        column: 20,
      });
    });

    it('should return null if no source map for script', () => {
      const result = manager.getGeneratedLocation(
        'unknown-script',
        'src/app.ts',
        5,
        10
      );

      expect(result).toBeNull();
    });
  });

  describe('getOriginalSource', () => {
    it('should return original source content', async () => {
      await loadTestSourceMap();

      const result = manager.getOriginalSource('script-1', 'src/app.ts');

      expect(result).toBe('const x = 1;');
    });

    it('should return null if no source map for script', () => {
      const result = manager.getOriginalSource('unknown-script', 'src/app.ts');

      expect(result).toBeNull();
    });
  });

  describe('getOriginalSources', () => {
    it('should return all original sources for a script', async () => {
      await loadTestSourceMap();

      const result = manager.getOriginalSources('script-1');

      expect(result).toEqual(['src/app.ts', 'src/utils.ts']);
    });

    it('should return undefined for unknown script', () => {
      const result = manager.getOriginalSources('unknown-script');

      expect(result).toBeUndefined();
    });
  });

  describe('hasSourceMap', () => {
    it('should return false when no source map loaded', () => {
      expect(manager.hasSourceMap('script-1')).toBe(false);
    });

    it('should return true when source map is loaded', async () => {
      await loadTestSourceMap();

      expect(manager.hasSourceMap('script-1')).toBe(true);
    });
  });

  describe('getSourceMapUrl', () => {
    it('should return undefined when no source map loaded', () => {
      expect(manager.getSourceMapUrl('script-1')).toBeUndefined();
    });

    it('should return the source map URL when loaded via loadSourceMap', async () => {
      const scriptInfo: ScriptInfo = {
        scriptId: 'script-1',
        url: 'http://localhost:3000/dist/bundle.js',
        sourceMapUrl: 'bundle.js.map',
        startLine: 0,
        startColumn: 0,
        endLine: 100,
        endColumn: 0,
        hash: 'abc123',
      };
      const fetchSourceMap = vi.fn().mockResolvedValue(
        JSON.stringify({version: 3, sources: [], mappings: ''})
      );

      await manager.loadSourceMap(scriptInfo, fetchSourceMap);

      expect(manager.getSourceMapUrl('script-1')).toBe(
        'http://localhost:3000/dist/bundle.js.map'
      );
    });
  });

  describe('removeSourceMap', () => {
    it('should remove a loaded source map', async () => {
      await loadTestSourceMap();

      expect(manager.hasSourceMap('script-1')).toBe(true);

      manager.removeSourceMap('script-1');

      expect(manager.hasSourceMap('script-1')).toBe(false);
    });

    it('should do nothing for non-existent source map', () => {
      expect(() => manager.removeSourceMap('unknown')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all loaded source maps', async () => {
      await loadTestSourceMap();

      expect(manager.hasSourceMap('script-1')).toBe(true);

      manager.clear();

      expect(manager.hasSourceMap('script-1')).toBe(false);
    });
  });
});
