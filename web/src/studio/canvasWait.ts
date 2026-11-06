// What the canvas says when there's nothing to draw. It follows the turn, so none of these can read as loading.
export type CanvasWait = 'idle' | 'waiting' | 'working' | 'nothing';

export const CANVAS_WAIT: Readonly<Record<CanvasWait, string>> = {
  idle: 'Nothing built yet. Describe a device in the chat to start.',
  waiting: 'Nothing built yet. Confirm in the chat to start.',
  working: 'Designing…',
  nothing: 'Nothing was built. See the chat.',
};

export function canvasWait(turn: { agentRunning: boolean; building: boolean; projectStarting: boolean; waitingOnMaker: boolean; hasTurns: boolean }): CanvasWait {
  if (turn.agentRunning || turn.building || turn.projectStarting) return 'working';
  if (turn.waitingOnMaker) return 'waiting';
  return turn.hasTurns ? 'nothing' : 'idle';
}
