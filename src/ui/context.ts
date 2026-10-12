import { createContext } from 'react';
import type { Engine } from '../scene/Engine';

export const EngineCtx = createContext<Engine | null>(null);
