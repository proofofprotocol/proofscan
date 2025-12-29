/**
 * Tests for summary command - Phase 3 categorization rules
 */

import { describe, it, expect } from 'vitest';
import { classifyTool, OperationCategory } from './summary.js';

describe('classifyTool', () => {
  // ============================================================
  // Time/Misc tools should be "other"
  // ============================================================
  describe('time/misc tools → other', () => {
    it('classifies get_current_time as other', () => {
      expect(classifyTool('get_current_time')).toBe('other');
    });

    it('classifies convert_time as other', () => {
      expect(classifyTool('convert_time')).toBe('other');
    });

    it('classifies get_timezone as other', () => {
      expect(classifyTool('get_timezone')).toBe('other');
    });

    it('classifies datetime_format as other', () => {
      expect(classifyTool('datetime_format')).toBe('other');
    });

    it('classifies get_date as other', () => {
      expect(classifyTool('get_date')).toBe('other');
    });

    it('classifies clock_sync as other', () => {
      expect(classifyTool('clock_sync')).toBe('other');
    });

    it('classifies calendar_event as other', () => {
      expect(classifyTool('calendar_event')).toBe('other');
    });
  });

  // ============================================================
  // Exec tools should be "exec" (highest priority)
  // ============================================================
  describe('exec tools → exec', () => {
    it('classifies run_command as exec', () => {
      expect(classifyTool('run_command')).toBe('exec');
    });

    it('classifies execute_script as exec', () => {
      expect(classifyTool('execute_script')).toBe('exec');
    });

    it('classifies bash as exec', () => {
      expect(classifyTool('bash')).toBe('exec');
    });

    it('classifies shell_exec as exec', () => {
      expect(classifyTool('shell_exec')).toBe('exec');
    });

    it('classifies powershell as exec', () => {
      expect(classifyTool('powershell')).toBe('exec');
    });

    it('classifies spawn_process as exec', () => {
      expect(classifyTool('spawn_process')).toBe('exec');
    });

    it('classifies terminal as exec', () => {
      expect(classifyTool('terminal')).toBe('exec');
    });

    it('classifies run_shell as exec', () => {
      expect(classifyTool('run_shell')).toBe('exec');
    });

    it('classifies run_script as exec', () => {
      expect(classifyTool('run_script')).toBe('exec');
    });
  });

  // ============================================================
  // "run" alone should be "other" (not exec)
  // ============================================================
  describe('run alone → other (not exec)', () => {
    it('classifies run_query as other', () => {
      expect(classifyTool('run_query')).toBe('other');
    });

    it('classifies run_test as other', () => {
      expect(classifyTool('run_test')).toBe('other');
    });

    it('classifies run_job as other', () => {
      expect(classifyTool('run_job')).toBe('other');
    });
  });

  // ============================================================
  // Network tools should be "network"
  // ============================================================
  describe('network tools → network', () => {
    it('classifies http_request as network', () => {
      expect(classifyTool('http_request')).toBe('network');
    });

    it('classifies fetch_url as network', () => {
      expect(classifyTool('fetch_url')).toBe('network');
    });

    it('classifies download_file as network', () => {
      expect(classifyTool('download_file')).toBe('network');
    });

    it('classifies upload_data as network', () => {
      expect(classifyTool('upload_data')).toBe('network');
    });

    it('classifies websocket_connect as network', () => {
      expect(classifyTool('websocket_connect')).toBe('network');
    });

    it('classifies curl as network', () => {
      expect(classifyTool('curl')).toBe('network');
    });

    it('classifies browser_open as network', () => {
      expect(classifyTool('browser_open')).toBe('network');
    });
  });

  // ============================================================
  // Write tools should be "write"
  // ============================================================
  describe('write tools → write', () => {
    it('classifies write_file as write', () => {
      expect(classifyTool('write_file')).toBe('write');
    });

    it('classifies create_document as write', () => {
      expect(classifyTool('create_document')).toBe('write');
    });

    it('classifies update_record as write', () => {
      expect(classifyTool('update_record')).toBe('write');
    });

    it('classifies delete_file as write', () => {
      expect(classifyTool('delete_file')).toBe('write');
    });

    it('classifies save_config as write', () => {
      expect(classifyTool('save_config')).toBe('write');
    });

    it('classifies mkdir as write', () => {
      expect(classifyTool('mkdir')).toBe('write');
    });

    it('classifies remove_entry as write', () => {
      expect(classifyTool('remove_entry')).toBe('write');
    });
  });

  // ============================================================
  // Read tools should be "read"
  // ============================================================
  describe('read tools → read', () => {
    it('classifies read_file as read', () => {
      expect(classifyTool('read_file')).toBe('read');
    });

    it('classifies list_files as read', () => {
      expect(classifyTool('list_files')).toBe('read');
    });

    it('classifies load_config as read', () => {
      expect(classifyTool('load_config')).toBe('read');
    });

    it('classifies cat as read', () => {
      expect(classifyTool('cat')).toBe('read');
    });

    it('classifies ls as read', () => {
      expect(classifyTool('ls')).toBe('read');
    });

    it('classifies view_log as read', () => {
      expect(classifyTool('view_log')).toBe('read');
    });
  });

  // ============================================================
  // search/query/find alone → other (not read)
  // ============================================================
  describe('search/query/find alone → other', () => {
    it('classifies search as other', () => {
      expect(classifyTool('search')).toBe('other');
    });

    it('classifies query as other', () => {
      expect(classifyTool('query')).toBe('other');
    });

    it('classifies find as other', () => {
      expect(classifyTool('find')).toBe('other');
    });

    it('classifies search_users as other', () => {
      expect(classifyTool('search_users')).toBe('other');
    });

    it('classifies query_database as other', () => {
      expect(classifyTool('query_database')).toBe('other');
    });
  });

  // ============================================================
  // search/query/find + file context → read
  // ============================================================
  describe('search/query/find + file context → read', () => {
    it('classifies search_file as read', () => {
      expect(classifyTool('search_file')).toBe('read');
    });

    it('classifies search_files as read', () => {
      expect(classifyTool('search_files')).toBe('read');
    });

    it('classifies find_file as read', () => {
      expect(classifyTool('find_file')).toBe('read');
    });

    it('classifies find_files as read', () => {
      expect(classifyTool('find_files')).toBe('read');
    });

    it('classifies query_file as read', () => {
      expect(classifyTool('query_file')).toBe('read');
    });

    it('classifies search_directory as read', () => {
      expect(classifyTool('search_directory')).toBe('read');
    });

    it('classifies find_path as read', () => {
      expect(classifyTool('find_path')).toBe('read');
    });

    it('classifies search with file description as read', () => {
      expect(classifyTool('search', 'Search for files in directory')).toBe('read');
    });

    it('classifies search_documents as read (document = file context)', () => {
      expect(classifyTool('search_documents')).toBe('read');
    });
  });

  // ============================================================
  // "get" alone should NOT be classified as read
  // ============================================================
  describe('get alone → other (not read)', () => {
    it('classifies get_status as other', () => {
      expect(classifyTool('get_status')).toBe('other');
    });

    it('classifies get_info as other', () => {
      expect(classifyTool('get_info')).toBe('other');
    });

    it('classifies get_version as other', () => {
      expect(classifyTool('get_version')).toBe('other');
    });

    it('classifies get_weather as other', () => {
      expect(classifyTool('get_weather')).toBe('other');
    });
  });

  // ============================================================
  // "get" + file-related → read
  // ============================================================
  describe('get + file-related → read', () => {
    it('classifies get_file as read', () => {
      expect(classifyTool('get_file')).toBe('read');
    });

    it('classifies get_file_content as read', () => {
      expect(classifyTool('get_file_content')).toBe('read');
    });

    it('classifies get_path as read', () => {
      expect(classifyTool('get_path')).toBe('read');
    });

    it('classifies get_directory as read', () => {
      expect(classifyTool('get_directory')).toBe('read');
    });

    it('classifies get_document as read', () => {
      expect(classifyTool('get_document')).toBe('read');
    });
  });

  // ============================================================
  // Priority: exec > network > write > misc > read
  // ============================================================
  describe('priority rules', () => {
    it('exec beats network (exec_http_request → exec)', () => {
      // Contains both exec and http, but exec has priority
      expect(classifyTool('exec_http')).toBe('exec');
    });

    it('network beats write (upload_file → network, not write)', () => {
      // upload is network keyword
      expect(classifyTool('upload_file')).toBe('network');
    });

    it('write beats time (create_time_entry → write, not other)', () => {
      // create is write keyword, takes priority over time
      expect(classifyTool('create_time_entry')).toBe('write');
    });

    it('run + command = exec', () => {
      expect(classifyTool('run_command')).toBe('exec');
    });

    it('run + shell = exec', () => {
      expect(classifyTool('run_shell')).toBe('exec');
    });

    it('run + time = other (not exec)', () => {
      // run alone + time → other (time takes priority, run needs exec context)
      expect(classifyTool('run_time_sync')).toBe('other');
    });
  });

  // ============================================================
  // Description-based classification
  // ============================================================
  describe('description-based classification', () => {
    it('uses description to classify generic tool', () => {
      expect(classifyTool('do_thing', 'Execute a shell command')).toBe('exec');
    });

    it('classifies by description when name is generic', () => {
      expect(classifyTool('helper', 'Read file contents')).toBe('read');
    });

    it('time in description forces other', () => {
      expect(classifyTool('get_value', 'Get current time in timezone')).toBe('other');
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================
  describe('edge cases', () => {
    it('handles empty name', () => {
      expect(classifyTool('')).toBe('other');
    });

    it('handles undefined description', () => {
      expect(classifyTool('unknown_tool', undefined)).toBe('other');
    });

    it('handles empty description', () => {
      expect(classifyTool('unknown_tool', '')).toBe('other');
    });

    it('is case insensitive', () => {
      expect(classifyTool('READ_FILE')).toBe('read');
      expect(classifyTool('Execute_Command')).toBe('exec');
      expect(classifyTool('GET_CURRENT_TIME')).toBe('other');
    });
  });
});
