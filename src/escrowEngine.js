import { logger } from './lib/logger.js';
/**
 * Escrow Engine
 * Simulates a trust protocol state machine for deals.
 * States: Pending -> Locked -> Verified -> Released
 */

export const EscrowState = {
  PENDING: 'Pending',
  LOCKED: 'Locked',
  VERIFIED: 'Verified',
  RELEASED: 'Released'
};

export class EscrowEngine {
  constructor(initialState = EscrowState.PENDING) {
    this.state = initialState;
    this.history = [{ state: this.state, timestamp: new Date() }];
  }

  getState() {
    return this.state;
  }

  transition(newState) {
    const validTransitions = {
      [EscrowState.PENDING]: [EscrowState.LOCKED],
      [EscrowState.LOCKED]: [EscrowState.VERIFIED],
      [EscrowState.VERIFIED]: [EscrowState.RELEASED],
      [EscrowState.RELEASED]: []
    };

    if (validTransitions[this.state] && validTransitions[this.state].includes(newState)) {
      this.state = newState;
      this.history.push({ state: this.state, timestamp: new Date() });
      return true;
    }
    
    logger.error('escrow', 'invalid state transition', { from: this.state, to: newState });
    return false;
  }
  
  lock() { return this.transition(EscrowState.LOCKED); }
  verify() { return this.transition(EscrowState.VERIFIED); }
  release() { return this.transition(EscrowState.RELEASED); }
}

/**
 * Returns a simulated escrow status based on match properties.
 * In a real app, this would be fetched from the database.
 */
export function getEscrowStatusForMatch(matchStatus) {
  if (matchStatus === 'accepted') {
    return EscrowState.PENDING; 
  } else if (matchStatus === 'suggested') {
    return null;
  }
  return null;
}
