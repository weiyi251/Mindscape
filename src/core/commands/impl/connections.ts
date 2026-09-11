// ============================================================================
// 模块说明（中文）
// 连线命令集。对应开发计划书 T3.1（创建）/ T3.2（标签 / 删除）与第 7.4 节。
//
// 连线数据（4.2）：{ id, from, to, label, color }，随 layout.json 落盘，
// 重开自动还原（layoutWriter 从 T1.6 起就序列化 connections）。
//
// 三条命令共享「apply 由上层注入」的模式；删除是软删除（undo 追加回来），
// 连线本身无文件操作，undo/redo 均为纯状态回滚。
// 实现任务：T3.1 / T3.2。
// ============================================================================

import type { Connection } from '@/core/types'
import type { Command } from '../types'

/** 追加连线（T3.1） */
export function createConnectionCommand(
  connection: Connection,
  applyAdd: (connection: Connection) => void,
  applyRemove: (ids: string[]) => void,
): Command {
  return {
    type: 'connect',

    do() {
      applyAdd(connection)
    },

    undo() {
      applyRemove([connection.id])
    },
  }
}

/** 删除连线（T3.2）。undo 追加回原对象（含标签） */
export function createRemoveConnectionsCommand(
  connections: Connection[],
  applyAdd: (connection: Connection) => void,
  applyRemove: (ids: string[]) => void,
): Command {
  return {
    type: 'disconnect',

    do() {
      applyRemove(connections.map((connection) => connection.id))
    },

    undo() {
      for (const connection of connections) applyAdd(connection)
    },
  }
}

/** 改连线标签（T3.2 双击编辑） */
export function createSetConnectionLabelCommand(
  id: string,
  from: string,
  to: string,
  apply: (id: string, label: string) => void,
): Command {
  return {
    type: 'connectionLabel',

    do() {
      apply(id, to)
    },

    undo() {
      apply(id, from)
    },
  }
}
