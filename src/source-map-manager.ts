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
 * Source Map Manager for resolving original source locations.
 *
 * @author John Grimes
 */

import {SourceMapConsumer, type RawSourceMap} from 'source-map';
import type {ScriptInfo, OriginalLocation} from './types.js';

/**
 * Manages source maps for loaded scripts and provides position mapping.
 */
export class SourceMapManager {
  private consumers = new Map<string, SourceMapConsumer>();
  private sourceMapUrls = new Map<string, string>();
  private originalSources = new Map<string, string[]>();

  /**
   * Loads a source map for a script.
   *
   * @param scriptInfo - Information about the script
   * @param fetchSourceMap - Function to fetch the source map content
   */
  async loadSourceMap(
    scriptInfo: ScriptInfo,
    fetchSourceMap: (url: string) => Promise<string | null>
  ): Promise<boolean> {
    if (!scriptInfo.sourceMapUrl) {
      return false;
    }

    try {
      // Resolve the source map URL relative to the script URL.
      const sourceMapUrl = this.resolveSourceMapUrl(
        scriptInfo.url,
        scriptInfo.sourceMapUrl
      );

      const sourceMapContent = await fetchSourceMap(sourceMapUrl);
      if (!sourceMapContent) {
        return false;
      }

      const rawSourceMap: RawSourceMap = JSON.parse(sourceMapContent);
      const consumer = await new SourceMapConsumer(rawSourceMap);

      this.consumers.set(scriptInfo.scriptId, consumer);
      this.sourceMapUrls.set(scriptInfo.scriptId, sourceMapUrl);
      this.originalSources.set(scriptInfo.scriptId, consumer.sources);

      return true;
    } catch (error) {
      // Source map loading failed; continue without it.
      console.error(
        `Failed to load source map for ${scriptInfo.url}:`,
        error
      );
      return false;
    }
  }

  /**
   * Loads an inline source map from a data URL.
   *
   * @param scriptId - The script ID
   * @param dataUrl - The data URL containing the source map
   */
  async loadInlineSourceMap(
    scriptId: string,
    dataUrl: string
  ): Promise<boolean> {
    try {
      // Parse the data URL.
      const match = dataUrl.match(
        /^data:application\/json;(?:charset=utf-8;)?base64,(.+)$/
      );
      if (!match) {
        return false;
      }

      const sourceMapContent = Buffer.from(match[1], 'base64').toString('utf-8');
      const rawSourceMap: RawSourceMap = JSON.parse(sourceMapContent);
      const consumer = await new SourceMapConsumer(rawSourceMap);

      this.consumers.set(scriptId, consumer);
      this.originalSources.set(scriptId, consumer.sources);

      return true;
    } catch (error) {
      console.error(`Failed to load inline source map:`, error);
      return false;
    }
  }

  /**
   * Gets the original location for a generated code position.
   *
   * @param scriptId - The script ID
   * @param line - The line number in generated code (1-based)
   * @param column - The column number in generated code (0-based)
   */
  getOriginalLocation(
    scriptId: string,
    line: number,
    column: number
  ): OriginalLocation | null {
    const consumer = this.consumers.get(scriptId);
    if (!consumer) {
      return null;
    }

    const original = consumer.originalPositionFor({line, column});
    if (!original.source) {
      return null;
    }

    return {
      source: original.source,
      line: original.line,
      column: original.column,
      name: original.name,
    };
  }

  /**
   * Gets the generated location for an original source position.
   *
   * @param scriptId - The script ID
   * @param source - The original source file path
   * @param line - The line number in original source (1-based)
   * @param column - The column number in original source (0-based)
   */
  getGeneratedLocation(
    scriptId: string,
    source: string,
    line: number,
    column: number
  ): {line: number | null; column: number | null} | null {
    const consumer = this.consumers.get(scriptId);
    if (!consumer) {
      return null;
    }

    const generated = consumer.generatedPositionFor({
      source,
      line,
      column,
    });

    if (generated.line === null) {
      return null;
    }

    return {
      line: generated.line,
      column: generated.column,
    };
  }

  /**
   * Gets the original source content for a source file.
   *
   * @param scriptId - The script ID
   * @param sourceUrl - The original source URL
   */
  getOriginalSource(scriptId: string, sourceUrl: string): string | null {
    const consumer = this.consumers.get(scriptId);
    if (!consumer) {
      return null;
    }

    return consumer.sourceContentFor(sourceUrl);
  }

  /**
   * Gets all original sources for a script.
   *
   * @param scriptId - The script ID
   */
  getOriginalSources(scriptId: string): string[] | undefined {
    return this.originalSources.get(scriptId);
  }

  /**
   * Checks if a script has a source map loaded.
   *
   * @param scriptId - The script ID
   */
  hasSourceMap(scriptId: string): boolean {
    return this.consumers.has(scriptId);
  }

  /**
   * Gets the source map URL for a script.
   *
   * @param scriptId - The script ID
   */
  getSourceMapUrl(scriptId: string): string | undefined {
    return this.sourceMapUrls.get(scriptId);
  }

  /**
   * Removes the source map for a script.
   *
   * @param scriptId - The script ID
   */
  removeSourceMap(scriptId: string): void {
    const consumer = this.consumers.get(scriptId);
    if (consumer) {
      consumer.destroy();
      this.consumers.delete(scriptId);
      this.sourceMapUrls.delete(scriptId);
      this.originalSources.delete(scriptId);
    }
  }

  /**
   * Clears all loaded source maps.
   */
  clear(): void {
    for (const consumer of this.consumers.values()) {
      consumer.destroy();
    }
    this.consumers.clear();
    this.sourceMapUrls.clear();
    this.originalSources.clear();
  }

  /**
   * Resolves a source map URL relative to the script URL.
   */
  private resolveSourceMapUrl(scriptUrl: string, sourceMapUrl: string): string {
    // Handle absolute URLs.
    if (
      sourceMapUrl.startsWith('http://') ||
      sourceMapUrl.startsWith('https://') ||
      sourceMapUrl.startsWith('file://')
    ) {
      return sourceMapUrl;
    }

    // Handle data URLs.
    if (sourceMapUrl.startsWith('data:')) {
      return sourceMapUrl;
    }

    // Resolve relative URL.
    try {
      const base = new URL(scriptUrl);
      return new URL(sourceMapUrl, base).toString();
    } catch {
      // If URL parsing fails, just concatenate.
      const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/') + 1);
      return baseDir + sourceMapUrl;
    }
  }
}
