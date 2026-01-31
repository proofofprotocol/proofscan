/**
 * Task Commands Tests (Phase 2.2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createTaskCommand } from '../task.js';
import { createA2AClient } from '../../a2a/client.js';

// Mock dependencies
vi.mock('../../a2a/client.js');

describe('task command', () => {
  let program: Command;
  let mockConfigPath: string;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigPath = '/test/config';
    program = new Command();
    program.addCommand(createTaskCommand(() => mockConfigPath));

    // Mock A2A client
    mockClient = {
      listTasks: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
    };

    vi.mocked(createA2AClient).mockResolvedValue({
      ok: true,
      client: mockClient,
      agentCard: { name: 'Test Agent', url: 'https://test.com', version: '1.0' },
    });
  });

  describe('task ls', () => {
    it('should list tasks successfully', async () => {
      mockClient.listTasks.mockResolvedValue({
        ok: true,
        response: {
          tasks: [
            {
              id: 'task-001',
              status: 'completed',
              contextId: 'ctx-001',
              messages: [{ role: 'user', parts: [{ text: 'test' }] }],
              createdAt: '2025-01-28T00:00:00Z',
            },
          ],
          pageSize: 50,
        },
      });

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'ls', 'test-agent'])
      ).resolves.not.toThrow();

      expect(createA2AClient).toHaveBeenCalledWith(mockConfigPath, 'test-agent');
      expect(mockClient.listTasks).toHaveBeenCalledWith({});

      processExitSpy.mockRestore();
    });

    it('should filter by context ID', async () => {
      mockClient.listTasks.mockResolvedValue({
        ok: true,
        response: {
          tasks: [],
          pageSize: 50,
        },
      });

      await program.parseAsync(['node', 'test', 'task', 'ls', 'test-agent', '--context', 'ctx-001']);

      expect(mockClient.listTasks).toHaveBeenCalledWith({ contextId: 'ctx-001' });
    });

    it('should filter by status', async () => {
      mockClient.listTasks.mockResolvedValue({
        ok: true,
        response: {
          tasks: [],
          pageSize: 50,
        },
      });

      await program.parseAsync(['node', 'test', 'task', 'ls', 'test-agent', '--status', 'completed']);

      expect(mockClient.listTasks).toHaveBeenCalledWith({ status: 'completed' });
    });

    it('should reject invalid status', async () => {
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'ls', 'test-agent', '--status', 'invalid'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });

    it('should fail when agent not found', async () => {
      vi.mocked(createA2AClient).mockResolvedValue({
        ok: false,
        error: "Agent 'test-agent' not found",
      });

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'ls', 'test-agent'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });
  });

  describe('task show', () => {
    it('should show task details', async () => {
      mockClient.getTask.mockResolvedValue({
        ok: true,
        task: {
          id: 'task-001',
          status: 'completed',
          contextId: 'ctx-001',
          messages: [
            { role: 'user', parts: [{ text: 'test' }] },
            { role: 'assistant', parts: [{ text: 'response' }] },
          ],
          artifacts: [
            {
              name: 'output.txt',
              description: 'Test output',
              parts: [{ text: 'content' }],
            },
          ],
          createdAt: '2025-01-28T00:00:00Z',
          updatedAt: '2025-01-28T01:00:00Z',
        },
      });

      await program.parseAsync(['node', 'test', 'task', 'show', 'test-agent', 'task-001']);

      expect(createA2AClient).toHaveBeenCalledWith(mockConfigPath, 'test-agent');
      expect(mockClient.getTask).toHaveBeenCalledWith('task-001', { historyLength: 10 });
    });

    it('should use custom history length', async () => {
      mockClient.getTask.mockResolvedValue({
        ok: true,
        task: {
          id: 'task-001',
          status: 'completed',
          messages: [],
        },
      });

      await program.parseAsync(['node', 'test', 'task', 'show', 'test-agent', 'task-001', '--history', '5']);

      expect(mockClient.getTask).toHaveBeenCalledWith('task-001', { historyLength: 5 });
    });

    it('should reject invalid history length', async () => {
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'show', 'test-agent', 'task-001', '--history', 'invalid'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });

    it('should fail when task not found', async () => {
      mockClient.getTask.mockResolvedValue({
        ok: false,
        error: 'Task not found',
      });

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'show', 'test-agent', 'task-001'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });
  });

  describe('task cancel', () => {
    it('should cancel a task', async () => {
      mockClient.cancelTask.mockResolvedValue({
        ok: true,
        task: {
          id: 'task-001',
          status: 'canceled',
          updatedAt: '2025-01-28T01:00:00Z',
        },
      });

      await program.parseAsync(['node', 'test', 'task', 'cancel', 'test-agent', 'task-001']);

      expect(createA2AClient).toHaveBeenCalledWith(mockConfigPath, 'test-agent');
      expect(mockClient.cancelTask).toHaveBeenCalledWith('task-001');
    });

    it('should handle cancel without task details', async () => {
      mockClient.cancelTask.mockResolvedValue({
        ok: true,
      });

      await program.parseAsync(['node', 'test', 'task', 'cancel', 'test-agent', 'task-001']);

      expect(mockClient.cancelTask).toHaveBeenCalledWith('task-001');
    });

    it('should fail on cancel error', async () => {
      mockClient.cancelTask.mockResolvedValue({
        ok: false,
        error: 'Task already completed',
      });

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'cancel', 'test-agent', 'task-001'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });
  });

  describe('task wait', () => {
    it('should wait for task completion', async () => {
      let callCount = 0;
      mockClient.getTask.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            task: { id: 'task-001', status: 'working', messages: [] },
          };
        }
        return {
          ok: true,
          task: {
            id: 'task-001',
            status: 'completed',
            messages: [{ role: 'assistant', parts: [{ text: 'done' }] }],
            createdAt: '2025-01-28T00:00:00Z',
            updatedAt: '2025-01-28T00:05:00Z',
          },
        };
      });

      // Mock setTimeout to resolve immediately for fast test
      vi.spyOn(global, 'setTimeout').mockImplementation((fn) => {
        fn();
        return {} as any;
      });

      await program.parseAsync(['node', 'test', 'task', 'wait', 'test-agent', 'task-001', '--timeout', '10']);

      expect(mockClient.getTask).toHaveBeenCalled();
    });

    it('should fail on timeout', async () => {
      mockClient.getTask.mockResolvedValue({
        ok: true,
        task: { id: 'task-001', status: 'working', messages: [] },
      });

      vi.useFakeTimers();
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      // Simulate polling that times out
      const promise = program.parseAsync([
        'node', 'test', 'task', 'wait', 'test-agent', 'task-001', '--timeout', '1',
      ]);

      // Advance time past timeout
      vi.advanceTimersByTime(2000);

      await expect(promise).rejects.toThrow('exit called');
      expect(processExitSpy).toHaveBeenCalledWith(1);

      vi.useRealTimers();
      processExitSpy.mockRestore();
    });

    it('should fail when task not found during wait', async () => {
      mockClient.getTask.mockResolvedValue({
        ok: false,
        error: 'Task not found',
      });

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'task', 'wait', 'test-agent', 'task-001'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });
  });
});
