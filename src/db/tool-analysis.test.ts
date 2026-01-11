/**
 * Tests for tool-analysis.ts
 */

import { describe, it, expect } from 'vitest';
import { classifyTool, type OperationCategory } from './tool-analysis.js';

describe('classifyTool', () => {
  describe('exec category (highest priority)', () => {
    it('should classify execute as exec', () => {
      expect(classifyTool('execute_command')).toBe('exec');
      expect(classifyTool('run', 'execute shell command')).toBe('exec');
    });

    it('should classify shell as exec', () => {
      expect(classifyTool('shell_exec')).toBe('exec');
      expect(classifyTool('run_shell')).toBe('exec');
    });

    it('should classify spawn as exec', () => {
      expect(classifyTool('spawn_process')).toBe('exec');
    });

    it('should classify run + exec context as exec', () => {
      expect(classifyTool('run_script')).toBe('exec');
      expect(classifyTool('run_command')).toBe('exec');
    });

    it('should not classify run without exec context as exec', () => {
      expect(classifyTool('run_diagnostics')).not.toBe('exec');
      expect(classifyTool('run', 'runs something')).not.toBe('exec');
    });
  });

  describe('network category', () => {
    it('should classify fetch as network', () => {
      expect(classifyTool('fetch_url')).toBe('network');
      expect(classifyTool('web_fetch')).toBe('network');
    });

    it('should classify http/https as network', () => {
      expect(classifyTool('http_get')).toBe('network');
      expect(classifyTool('https_request')).toBe('network');
    });

    it('should classify request/api as network', () => {
      expect(classifyTool('api_request')).toBe('network');
      expect(classifyTool('send_request')).toBe('network');
    });

    it('should classify download/upload as network', () => {
      expect(classifyTool('download_file')).toBe('network');
      expect(classifyTool('upload_data')).toBe('network');
    });

    it('should classify socket/websocket as network', () => {
      expect(classifyTool('websocket_connect')).toBe('network');
      expect(classifyTool('socket_send')).toBe('network');
    });

    it('should prioritize exec over network', () => {
      // exec keywords take priority
      expect(classifyTool('execute_api_request')).toBe('exec');
    });
  });

  describe('write category', () => {
    it('should classify write as write', () => {
      expect(classifyTool('write_file')).toBe('write');
    });

    it('should classify create/insert as write', () => {
      expect(classifyTool('create_document')).toBe('write');
      expect(classifyTool('insert_record')).toBe('write');
    });

    it('should classify update/modify as write', () => {
      expect(classifyTool('update_config')).toBe('write');
      expect(classifyTool('modify_settings')).toBe('write');
    });

    it('should classify delete/remove as write', () => {
      expect(classifyTool('delete_file')).toBe('write');
      expect(classifyTool('remove_entry')).toBe('write');
    });

    it('should classify append/save as write', () => {
      expect(classifyTool('append_log')).toBe('write');
      expect(classifyTool('save_document')).toBe('write');
    });

    it('should classify put/post as write', () => {
      expect(classifyTool('put_item')).toBe('write');
      expect(classifyTool('post_data')).toBe('write');
    });
  });

  describe('read category', () => {
    it('should classify read as read', () => {
      expect(classifyTool('read_file')).toBe('read');
    });

    it('should classify list as read', () => {
      expect(classifyTool('list_files')).toBe('read');
      expect(classifyTool('list_directory')).toBe('read');
    });

    it('should classify view/show as read', () => {
      expect(classifyTool('view_document')).toBe('read');
      expect(classifyTool('show_content')).toBe('read');
    });

    it('should classify cat/head/tail as read', () => {
      expect(classifyTool('cat_file')).toBe('read');
      expect(classifyTool('head_lines')).toBe('read');
      expect(classifyTool('tail_log')).toBe('read');
    });

    it('should classify get + file context as read', () => {
      expect(classifyTool('get_file_content')).toBe('read');
      expect(classifyTool('get_document')).toBe('read');
    });

    it('should classify search/query + file context as read', () => {
      expect(classifyTool('search_files')).toBe('read');
      expect(classifyTool('query_documents')).toBe('read');
      expect(classifyTool('find_in_directory')).toBe('read');
    });
  });

  describe('other category', () => {
    it('should classify time-related as other', () => {
      expect(classifyTool('get_current_time')).toBe('other');
      expect(classifyTool('get_timezone')).toBe('other');
      expect(classifyTool('convert_time')).toBe('other');
    });

    it('should classify date-related as other', () => {
      expect(classifyTool('get_date')).toBe('other');
      expect(classifyTool('format_date')).toBe('other');
    });

    it('should classify random as other', () => {
      expect(classifyTool('random_number')).toBe('other');
      expect(classifyTool('generate_random')).toBe('other');
    });

    it('should classify calculate/compute as other', () => {
      expect(classifyTool('calculate_sum')).toBe('other');
      expect(classifyTool('compute_hash')).toBe('other');
    });

    it('should classify format/parse as other', () => {
      expect(classifyTool('format_json')).toBe('other');
      expect(classifyTool('parse_xml')).toBe('other');
    });

    it('should classify echo/ping as other', () => {
      expect(classifyTool('echo_input')).toBe('other');
      expect(classifyTool('ping_service')).toBe('other');
    });

    it('should classify unknown tools as other', () => {
      expect(classifyTool('mystery_tool')).toBe('other');
      expect(classifyTool('do_something')).toBe('other');
    });
  });

  describe('edge cases', () => {
    it('should handle empty name', () => {
      expect(classifyTool('')).toBe('other');
    });

    it('should handle undefined description', () => {
      expect(classifyTool('some_tool', undefined)).toBe('other');
    });

    it('should use description for classification', () => {
      // Name doesn't indicate, but description does
      expect(classifyTool('do_it', 'executes a shell command')).toBe('exec');
      expect(classifyTool('perform', 'fetches data from url')).toBe('network');
    });

    it('should prioritize exec over all others', () => {
      expect(classifyTool('execute_read_write_fetch')).toBe('exec');
    });

    it('should prioritize network over write/read', () => {
      expect(classifyTool('fetch_and_write_file')).toBe('network');
    });

    it('should prioritize write over read', () => {
      expect(classifyTool('read_and_write_file')).toBe('write');
    });

    it('should handle case insensitivity in description', () => {
      expect(classifyTool('tool', 'EXECUTE COMMAND')).toBe('exec');
      expect(classifyTool('tool', 'Fetch URL')).toBe('network');
    });

    it('should match whole words only', () => {
      // "cat" should match
      expect(classifyTool('cat_file')).toBe('read');
      // "read" as whole word should match
      expect(classifyTool('read_file')).toBe('read');
      // But partial matches may not work (wordPattern uses word boundaries)
      // "reading" won't match "read" pattern due to word boundary
    });
  });

  describe('priority order verification', () => {
    // Verify: exec > network > write > read > other

    it('should verify complete priority chain', () => {
      // exec beats everything
      expect(classifyTool('shell')).toBe('exec');

      // network beats write
      expect(classifyTool('fetch_and_save')).toBe('network');

      // write beats read
      expect(classifyTool('read_modify_write')).toBe('write');

      // read beats other for file-related
      expect(classifyTool('get_file')).toBe('read');
    });
  });
});
