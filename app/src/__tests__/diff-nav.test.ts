import { describe, it, expect, beforeEach } from 'vitest';
import {
  _diffTotalAdds, _diffTotalDels, _diffTotalFiles,
  _diffBlocks, _diffCurrentNav, _lastDiffGroup, _diffSummary,
  resetDiffState, setDiffTotalAdds, setDiffTotalDels, setDiffTotalFiles,
  incrDiffTotalAdds, incrDiffTotalDels, incrDiffTotalFiles,
  setDiffCurrentNav, setLastDiffGroup, pushDiffBlock,
  closeDiffBlock, diffObjectName,
} from '../terminal/diff-nav';

beforeEach(() => {
  resetDiffState();
  document.body.innerHTML = '';
});

describe('resetDiffState', () => {
  it('zeroes all counters', () => {
    incrDiffTotalAdds();
    incrDiffTotalAdds();
    incrDiffTotalDels();
    incrDiffTotalFiles();
    setDiffCurrentNav(5);
    setLastDiffGroup('test');
    resetDiffState();
    expect(_diffTotalAdds).toBe(0);
    expect(_diffTotalDels).toBe(0);
    expect(_diffTotalFiles).toBe(0);
    expect(_diffCurrentNav).toBe(-1);
    expect(_lastDiffGroup).toBe('');
    expect(_diffBlocks).toEqual([]);
    expect(_diffSummary.objects).toBe(0);
  });
});

describe('setters and incrementers', () => {
  it('setDiffTotalAdds', () => {
    setDiffTotalAdds(42);
    expect(_diffTotalAdds).toBe(42);
  });

  it('setDiffTotalDels', () => {
    setDiffTotalDels(10);
    expect(_diffTotalDels).toBe(10);
  });

  it('setDiffTotalFiles', () => {
    setDiffTotalFiles(5);
    expect(_diffTotalFiles).toBe(5);
  });

  it('incrDiffTotalAdds', () => {
    incrDiffTotalAdds();
    incrDiffTotalAdds();
    incrDiffTotalAdds();
    expect(_diffTotalAdds).toBe(3);
  });

  it('incrDiffTotalDels', () => {
    incrDiffTotalDels();
    expect(_diffTotalDels).toBe(1);
  });

  it('incrDiffTotalFiles', () => {
    incrDiffTotalFiles();
    incrDiffTotalFiles();
    expect(_diffTotalFiles).toBe(2);
  });

  it('setDiffCurrentNav', () => {
    setDiffCurrentNav(3);
    expect(_diffCurrentNav).toBe(3);
  });

  it('setLastDiffGroup', () => {
    setLastDiffGroup('Objects/MyObj');
    expect(_lastDiffGroup).toBe('Objects/MyObj');
  });
});

describe('pushDiffBlock', () => {
  it('adds element to blocks array', () => {
    const el = document.createElement('div');
    pushDiffBlock(el);
    expect(_diffBlocks).toHaveLength(1);
    expect(_diffBlocks[0]).toBe(el);
  });

  it('accumulates multiple blocks', () => {
    pushDiffBlock(document.createElement('div'));
    pushDiffBlock(document.createElement('div'));
    pushDiffBlock(document.createElement('div'));
    expect(_diffBlocks).toHaveLength(3);
  });
});

describe('diffObjectName', () => {
  it('extracts base name from path with extension', () => {
    expect(diffObjectName('Objects/MyObj.nabsic')).toBe('Objects/MyObj');
  });

  it('extracts base name with multiple dots', () => {
    expect(diffObjectName('path/to/Foo.bar.txt')).toBe('path/to/Foo');
  });

  it('handles root files', () => {
    expect(diffObjectName('Foo.txt')).toBe('Foo');
  });

  it('handles files without extension', () => {
    expect(diffObjectName('Makefile')).toBe('Makefile');
  });

  it('handles nested paths', () => {
    expect(diffObjectName('a/b/c/File.xml')).toBe('a/b/c/File');
  });

  it('handles path with trailing slash edge case', () => {
    expect(diffObjectName('dir/')).toBe('dir/');
  });
});

describe('closeDiffBlock', () => {
  it('does nothing with null block', () => {
    // Should not throw
    closeDiffBlock(null, null, 0, 0);
  });

  it('removes block when adds=0 and dels=0', () => {
    const parent = document.createElement('div');
    const block = document.createElement('div');
    block.innerHTML = '<span class="diff-count"></span>';
    parent.appendChild(block);
    document.body.appendChild(parent);
    closeDiffBlock(block, null, 0, 0);
    expect(parent.contains(block)).toBe(false);
  });

  it('labels as "new" when adds only', () => {
    const block = document.createElement('div');
    block.className = 'diff-block';
    const count = document.createElement('span');
    count.className = 'diff-count';
    block.appendChild(count);
    document.body.appendChild(block);

    // Add termOutput for updateDiffSummary
    const termOutput = document.createElement('div');
    termOutput.id = 'termOutput';
    termOutput.appendChild(block);
    document.body.appendChild(termOutput);

    closeDiffBlock(block, null, 3, 0);
    expect(count.innerHTML).toContain('new');
    expect(count.innerHTML).toContain('+3');
  });

  it('labels as "del" when dels only', () => {
    const block = document.createElement('div');
    block.className = 'diff-block';
    const count = document.createElement('span');
    count.className = 'diff-count';
    block.appendChild(count);

    const termOutput = document.createElement('div');
    termOutput.id = 'termOutput';
    termOutput.appendChild(block);
    document.body.appendChild(termOutput);

    closeDiffBlock(block, null, 0, 5);
    expect(count.innerHTML).toContain('del');
  });

  it('labels as "mod" when both adds and dels', () => {
    const block = document.createElement('div');
    block.className = 'diff-block';
    const count = document.createElement('span');
    count.className = 'diff-count';
    block.appendChild(count);

    const termOutput = document.createElement('div');
    termOutput.id = 'termOutput';
    termOutput.appendChild(block);
    document.body.appendChild(termOutput);

    closeDiffBlock(block, null, 2, 3);
    expect(count.innerHTML).toContain('mod');
    expect(count.innerHTML).toContain('+2');
  });
});
