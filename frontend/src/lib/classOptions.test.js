import { buildClassOptions, sortClasses, uniqueClasses, classOptionLabels, compareClasses } from './classOptions';

const JC = 'c1dbb90b-a243-424c-b51d-6023b77307c8';
const SEC = '1b0e82a1-5b2d-4143-95d2-44d3d84bde08';
const PRI = '33ec0669-7c0e-4302-9eb8-ccae8b51163a';

// Mirrors the Junior College records actually stored (same names, streams, ids).
const jcRecords = [
  { id: 'j12-sci', name: 'Class 12', department_id: JC, stream: 'Science', medium: 'Junior College' },
  { id: 'j11-art', name: 'Class 11', department_id: JC, stream: 'Arts', medium: 'Junior College' },
  { id: 'j11-bif', name: 'Class 11', department_id: JC, stream: 'Bi-Focal', medium: 'Junior College' },
  { id: 'j11-fis', name: 'Class 11', department_id: JC, stream: 'Fisheries', medium: 'Junior College' },
  { id: 'j11-com', name: 'Class 11', department_id: JC, stream: 'Commerce', medium: 'Junior College' },
  { id: 'j11-sci', name: 'Class 11', department_id: JC, stream: 'Science', medium: 'Junior College' },
  { id: 'j12-art', name: 'Class 12', department_id: JC, stream: 'Arts', medium: 'Junior College' },
  { id: 'j12-com', name: 'Class 12', department_id: JC, stream: 'Commerce', medium: 'Junior College' },
  { id: 'j12-bif', name: 'Class 12', department_id: JC, stream: 'Bi-Focal', medium: 'Junior College' },
  { id: 'j12-fis', name: 'Class 12', department_id: JC, stream: 'Fisheries', medium: 'Junior College' },
];

const secondary = [
  { id: 's10-en', name: 'Class 10', department_id: SEC, medium: 'English Medium' },
  { id: 's10-mr', name: 'Class 10', department_id: SEC, medium: 'Semi Medium (Marathi)' },
  { id: 's6', name: 'Class 6', department_id: SEC },
  { id: 's2', name: 'Class 2', department_id: SEC },
  { id: 's9-en', name: 'Class 9', department_id: SEC, medium: 'English Medium' },
];

const primary = [
  { id: 'p8', name: 'Class 8', department_id: PRI, medium: 'English Medium' },
  { id: 'p1', name: 'Class 1', department_id: PRI, medium: 'English Medium' },
  { id: 'p2', name: 'Class 2', department_id: PRI, medium: 'English Medium' },
  { id: 'pkg', name: 'KG I', department_id: PRI, medium: 'English Medium' },
  { id: 'pnu', name: 'Nursery', department_id: PRI, medium: 'English Medium' },
];

const all = [...jcRecords, ...secondary, ...primary];

describe('numeric class ordering', () => {
  test('Class 1 comes before Class 2 and Class 10 (not alphabetical)', () => {
    const names = sortClasses(primary.filter(c => c.name.startsWith('Class'))).map(c => c.name);
    expect(names).toEqual(['Class 1', 'Class 2', 'Class 8']);
  });

  test('Class 2 sorts before Class 10 even when given in reverse', () => {
    expect(compareClasses({ name: 'Class 2' }, { name: 'Class 10' })).toBeLessThan(0);
  });

  test('named levels (KG, Nursery) come before numbered classes', () => {
    const names = sortClasses(primary).map(c => c.name);
    expect(names.indexOf('Nursery')).toBeLessThan(names.indexOf('Class 1'));
    expect(names.indexOf('KG I')).toBeLessThan(names.indexOf('Class 1'));
  });

  test('ordering is deterministic regardless of input order', () => {
    const forward = sortClasses(all).map(c => c.id);
    const reversed = sortClasses([...all].reverse()).map(c => c.id);
    expect(reversed).toEqual(forward);
  });
});

describe('Junior College options (real stream data)', () => {
  const opts = buildClassOptions(all, JC).map(o => o.label);

  test('shows Class 11 then Class 12, each with its stream', () => {
    expect(opts).toEqual([
      'Class 11 — Arts', 'Class 11 — Commerce', 'Class 11 — Science', 'Class 11 — Bi-Focal',
      'Class 12 — Arts', 'Class 12 — Commerce', 'Class 12 — Science', 'Class 12 — Bi-Focal',
    ]);
  });

  test('uses the canonical stream order Arts, Commerce, Science, Bi-Focal', () => {
    const stream = opts.filter(l => l.startsWith('Class 11')).map(l => l.split(' — ')[1]);
    expect(stream).toEqual(['Arts', 'Commerce', 'Science', 'Bi-Focal']);
  });

  test('no two options are identical', () => {
    expect(new Set(opts).size).toBe(opts.length);
  });

  test('legacy Fisheries streams are not offered (they hold no students)', () => {
    expect(opts.some(l => l.includes('Fisheries'))).toBe(false);
  });
});

describe('duplicates', () => {
  test('exact duplicates (same dept, name, stream, medium) collapse to one option', () => {
    const dup = [...jcRecords, { id: 'j11-art-copy', name: 'Class 11', department_id: JC, stream: 'Arts', medium: 'Junior College' }];
    const labels = buildClassOptions(dup, JC).map(o => o.label);
    expect(labels.filter(l => l === 'Class 11 — Arts')).toHaveLength(1);
  });

  test('different streams with the same class name are kept, not merged', () => {
    expect(uniqueClasses(jcRecords).filter(c => c.name === 'Class 11')).toHaveLength(5);
  });

  test('same class name in two mediums is labelled by medium', () => {
    const labels = buildClassOptions(secondary, SEC).map(o => o.label);
    expect(labels).toContain('Class 10 — English Medium');
    expect(labels).toContain('Class 10 — Semi Medium (Marathi)');
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('a unique class name keeps its plain label', () => {
    expect(classOptionLabels([{ id: 'x', name: 'Class 6', department_id: SEC }])[0].label).toBe('Class 6');
  });
});

describe('department filtering', () => {
  test('Junior College selector shows only Junior College classes', () => {
    const labels = buildClassOptions(all, JC).map(o => o.label);
    expect(labels.every(l => l.startsWith('Class 11') || l.startsWith('Class 12'))).toBe(true);
  });

  test('Secondary selector excludes primary and JC classes', () => {
    const ids = buildClassOptions(all, SEC).map(o => o.id);
    expect(ids).not.toContain('p1');
    expect(ids).not.toContain('j11-art');
  });

  test('no department selected returns every non-legacy class', () => {
    const ids = buildClassOptions(all, '').map(o => o.id);
    expect(ids).toContain('p1');
    expect(ids).toContain('j11-art');
    expect(ids).not.toContain('j11-fis');
  });
});

describe('Secondary and Primary ordering', () => {
  test('Secondary: Class 2, Class 6, Class 9, Class 10 in numeric order', () => {
    const names = buildClassOptions(secondary, SEC).map(o => o.label.split(' — ')[0]);
    expect(names).toEqual(['Class 2', 'Class 6', 'Class 9', 'Class 10', 'Class 10']);
  });
});
