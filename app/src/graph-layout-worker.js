import { expose } from 'comlink';
import { layoutGraph } from '../../core/graph-layout.mjs';

let generation = 0;
expose({
  async layout(input) { const request = ++generation; return layoutGraph(input, () => request !== generation); },
  cancel() { generation++; },
});