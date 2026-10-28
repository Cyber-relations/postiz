// Read-only ELF inventory candidate. No dlopen, require(addon), exec, network or writes.
// Run only in the independently bound final image/current existing Exec after review.
// Imported from root's prepared observer (SHA-256 7cc4b225…) and changed for the
// 2026-10-16 review: the declared roots are Postiz's real pnpm workspace (apps/*,
// libraries/*) plus node_modules, symlinks are followed inside /app, and an inventory
// is complete only when every declared root is present, at least one ELF was read,
// no DT_NEEDED was omitted from the output, and every PT_DYNAMIC was resolved (the
// program headers, not the optional section headers, are the source of record).
// Changed on 2026-10-19 for two false positives on the real image: a symlink whose target
// does not exist is counted in dangling_symlinks, not as an error, and a SysV hash with no
// bucket and only the null symbol (a static-pie) is resolved with 0 symbols.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const assert = (condition, code) => { if (!condition) throw new Error(code); };
const riskSymbol = name => /^(?:gz[A-Za-z0-9_]*|strfmon(?:_l)?|ns_sprintrr[f]?|hes_[A-Za-z0-9_]+|acl_[A-Za-z0-9_]+|mount|umount2?|open_tree|fsopen|fsmount|move_mount|setns|unshare|system|popen|execv[ep]?|execl[ep]?|posix_spawnp?)$/.test(name);

// The dynamic metadata the loader uses is reached through the program headers
// (PT_DYNAMIC, with DT_STRTAB/DT_SYMTAB mapped by PT_LOAD); section headers are optional
// and can be stripped or wrong. When PT_DYNAMIC exists it is the source of record and the
// section tables, if present, must agree with it. A PT_DYNAMIC that cannot be resolved
// (an unmapped table, no hash table to size the symbols) is reported as unresolved.
export function elfInventory(buffer) {
  assert(buffer.length >= 64 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'NOT_ELF');
  // Only ELF64 little-endian is read (the image is amd64); anything else is reported, not guessed.
  assert(buffer[4] === 2, 'ELF_UNSUPPORTED_CLASS');
  assert(buffer[5] === 1, 'ELF_UNSUPPORTED_ENDIAN');
  const number = value => { assert(value <= BigInt(Number.MAX_SAFE_INTEGER), 'ELF_UNSAFE_OFFSET'); return Number(value); };
  const range = (start, size) => {
    assert(Number.isSafeInteger(start) && Number.isSafeInteger(size) && start >= 0 && size >= 0 && start <= buffer.length && size <= buffer.length - start, 'ELF_RANGE');
    return buffer.subarray(start, start + size);
  };
  const string = (table, offset) => {
    assert(Number.isSafeInteger(offset) && offset >= 0 && offset < table.length, 'ELF_STRING_OFFSET');
    const end = table.indexOf(0, offset); assert(end >= offset && end - offset <= 4096, 'ELF_STRING_BOUND');
    return table.subarray(offset, end).toString('utf8');
  };
  const plainName = name => /^[A-Za-z0-9._+-]{1,100}$/.test(name);
  // DT_NEEDED: an offset beyond 2^53 or outside the string table cannot be located; the
  // entry leaves the table unresolved (never an error), on the section and segment paths alike.
  const addNeeded = (result, strings, value) => {
    const offset = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(offset) || offset >= strings.length) { result.neededUnresolved = true; return; }
    const name = string(strings, offset);
    if (plainName(name)) result.needed.add(name);
    else result.nonBasenameNeeded = true; // Never print an absolute path or arbitrary string.
  };
  const collect = () => ({ needed: new Set(), imports: new Set(), exports: new Set(), symbols: 0,
    nonBasenameNeeded: false, neededUnresolved: false, rpath: false, runpath: false });
  const addSymbol = (result, name, defined) => {
    result.symbols += 1;
    if (riskSymbol(name)) (defined ? result.exports : result.imports).add(name);
  };

  // Program headers: PT_LOAD mappings and the single PT_DYNAMIC.
  const phoff = number(buffer.readBigUInt64LE(32));
  const phentsize = buffer.readUInt16LE(54); const phnum = buffer.readUInt16LE(56);
  const loads = []; let dynamicSegment = null;
  if (phnum > 0) {
    assert(phentsize === 56 && phnum <= 4096, 'ELF_PROGRAM_HEADERS_NOT_OBSERVABLE');
    range(phoff, phentsize * phnum);
    for (let index = 0; index < phnum; index += 1) {
      const at = phoff + index * phentsize;
      const type = buffer.readUInt32LE(at);
      const segment = { offset: number(buffer.readBigUInt64LE(at + 8)), vaddr: number(buffer.readBigUInt64LE(at + 16)),
        filesz: number(buffer.readBigUInt64LE(at + 32)), memsz: number(buffer.readBigUInt64LE(at + 40)),
        align: number(buffer.readBigUInt64LE(at + 48)) };
      assert(Number.isSafeInteger(segment.vaddr + segment.memsz) && Number.isSafeInteger(segment.vaddr + segment.filesz)
        && Number.isSafeInteger(segment.offset + segment.filesz), 'ELF_UNSAFE_OFFSET');
      if (type === 1) {
        assert(segment.filesz <= segment.memsz, 'ELF_AMBIGUOUS_LOAD'); // file bytes beyond the mapped memory
        range(segment.offset, segment.filesz); loads.push(segment);
      }
      if (type === 2) { assert(!dynamicSegment, 'ELF_AMBIGUOUS_DYNAMIC_TABLE'); range(segment.offset, segment.filesz); dynamicSegment = segment; }
    }
  }

  // Section headers: optional only when there are none at all and PT_DYNAMIC exists.
  const shoff = number(buffer.readBigUInt64LE(40));
  const shentsize = buffer.readUInt16LE(58); const shnum = buffer.readUInt16LE(60);
  const sections = [];
  if (shoff !== 0 || shnum !== 0 || !dynamicSegment) {
    assert(shoff > 0 && shnum > 0 && shnum <= 8192 && shentsize === 64, 'ELF_SECTIONS_NOT_OBSERVABLE');
    range(shoff, shentsize * shnum);
    for (let index = 0; index < shnum; index += 1) {
      const at = shoff + index * shentsize;
      const section = { type: buffer.readUInt32LE(at + 4), offset: number(buffer.readBigUInt64LE(at + 24)),
        size: number(buffer.readBigUInt64LE(at + 32)), link: buffer.readUInt32LE(at + 40), entrySize: number(buffer.readBigUInt64LE(at + 56)) };
      if (section.type !== 8) range(section.offset, section.size); // SHT_NOBITS has no file bytes.
      sections.push(section);
    }
  }
  const tableFor = section => {
    const table = sections[section.link]; assert(table && table.type === 3, 'ELF_LINKED_STRING_TABLE');
    return range(table.offset, table.size);
  };
  const fromSections = collect();
  const symbolSections = sections.filter(section => section.type === 11);
  const dynamicSections = sections.filter(section => section.type === 6);
  assert(symbolSections.length <= 1 && dynamicSections.length <= 1, 'ELF_AMBIGUOUS_DYNAMIC_TABLE');
  for (const section of symbolSections) {
    assert(section.entrySize === 24 && section.size % 24 === 0 && section.size / 24 <= 500000, 'ELF_SYMBOL_TABLE_BOUND');
    const strings = tableFor(section);
    for (let at = section.offset; at < section.offset + section.size; at += 24) {
      const offset = buffer.readUInt32LE(at); if (!offset) continue;
      addSymbol(fromSections, string(strings, offset), buffer.readUInt16LE(at + 6) !== 0);
    }
  }
  for (const section of dynamicSections) {
    assert(section.entrySize === 16 && section.size % 16 === 0 && section.size / 16 <= 65536, 'ELF_DYNAMIC_TABLE_BOUND');
    const strings = tableFor(section); let terminated = false;
    for (let at = section.offset; at < section.offset + section.size; at += 16) {
      const tag = buffer.readBigInt64LE(at); if (tag === 0n) { terminated = true; break; }
      if (tag === 15n) fromSections.rpath = true;
      if (tag === 29n) fromSections.runpath = true;
      if (tag !== 1n) continue;
      addNeeded(fromSections, strings, buffer.readBigUInt64LE(at + 8));
    }
    assert(terminated, 'ELF_UNTERMINATED_DYNAMIC_TABLE');
  }

  // PT_DYNAMIC, resolved the way the loader does: by virtual address through PT_LOAD.
  let fromSegment = null; let unresolved = false; let symtabOffset = null; let segmentSymtab = false;
  let segmentStrings = false; let segmentSymbols = false; let countBasis = null; let lowerBound = false;
  if (dynamicSegment) {
    // The loader maps whole 4 KiB pages (glibc dl-map-segments.h): each PT_LOAD maps the file
    // pages from floor(offset) onto [floor(vaddr), ceil(vaddr + filesz)) - one page even when
    // filesz is 0 and vaddr is not page aligned - and, when memsz > filesz, zero-fills
    // [vaddr + filesz, ceil(vaddr + memsz)). Two file-backed ranges may share a page only when
    // they map the same file page to it (equal vaddr - offset); memory byte ranges may not
    // overlap. Segments are mapped and zero-filled in program-header order, so for A before B:
    // B's file pages [floor(vaddr), ceil(vaddr + filesz)) may not cover A's zero-filled part
    // (B's mapping would overwrite it), and A's file bytes [vaddr, vaddr + filesz) may not fall
    // in B's zero-filled part (B's zero fill would erase them). So a pure zero-filled segment may
    // follow, in the same page and with the same mapping, one that zero-fills nothing there.
    // Ranges are half-open.
    // p_align is checked as alignment only (vaddr = offset modulo p_align), never as page size.
    const floorPage = value => Math.floor(value / PAGE_SIZE) * PAGE_SIZE;
    const ceilPage = value => Math.ceil(value / PAGE_SIZE) * PAGE_SIZE;
    const overlaps = ([a, b], [c, d]) => a < b && c < d && a < d && c < b;
    const mapped = loads.map(item => ({ bias: item.vaddr - item.offset,
      bytes: [item.vaddr, item.vaddr + item.memsz],
      file: [floorPage(item.vaddr), ceilPage(item.vaddr + item.filesz)],
      fileBytes: [item.vaddr, item.vaddr + item.filesz],
      zero: item.memsz > item.filesz ? [item.vaddr + item.filesz, ceilPage(item.vaddr + item.memsz)] : [0, 0] }));
    for (const item of loads) {
      // The loader refuses a segment whose address and offset differ within a page.
      assert((item.vaddr - item.offset) % PAGE_SIZE === 0, 'ELF_AMBIGUOUS_LOAD');
      if (item.align > 1) {
        assert(Number.isInteger(Math.log2(item.align)) && (item.vaddr - item.offset) % item.align === 0, 'ELF_AMBIGUOUS_LOAD');
      }
    }
    for (let a = 0; a < mapped.length; a += 1) {
      for (let b = a + 1; b < mapped.length; b += 1) {
        const x = mapped[a]; const y = mapped[b]; // x comes before y in the program headers
        assert(!overlaps(x.bytes, y.bytes), 'ELF_AMBIGUOUS_LOAD');
        assert(!overlaps(x.file, y.file) || x.bias === y.bias, 'ELF_AMBIGUOUS_LOAD');
        assert(!overlaps(y.file, x.zero) && !overlaps(x.fileBytes, y.zero), 'ELF_AMBIGUOUS_LOAD');
      }
    }
    // The file offset of a whole [vaddr, vaddr + size) inside one PT_LOAD, or null when the
    // range is unmapped or crosses a segment boundary.
    const resolve = (vaddr, size) => {
      if (!Number.isSafeInteger(vaddr) || !Number.isSafeInteger(size) || vaddr < 0 || size < 0
        || !Number.isSafeInteger(vaddr + size)) return null;
      const segment = loads.find(item => vaddr >= item.vaddr && vaddr + size <= item.vaddr + item.filesz);
      return segment ? segment.offset + (vaddr - segment.vaddr) : null;
    };
    assert(resolve(dynamicSegment.vaddr, dynamicSegment.filesz) === dynamicSegment.offset, 'ELF_DYNAMIC_MISMATCH');
    const tags = { needed: [], strtab: null, strsz: null, symtab: null, syment: null, hash: null, gnuHash: null,
      rela: null, relasz: null, relaent: null, rel: null, relsz: null, relent: null, jmprel: null, pltrelsz: null, pltrel: null,
      versym: null, verneed: null, verdef: null };
    const tagNames = new Map([[2n, 'pltrelsz'], [4n, 'hash'], [5n, 'strtab'], [6n, 'symtab'], [7n, 'rela'], [8n, 'relasz'],
      [9n, 'relaent'], [10n, 'strsz'], [11n, 'syment'], [17n, 'rel'], [18n, 'relsz'], [19n, 'relent'], [20n, 'pltrel'],
      [23n, 'jmprel'], [0x6ffffef5n, 'gnuHash'], [0x6ffffff0n, 'versym'], [0x6ffffffen, 'verneed'], [0x6ffffffcn, 'verdef']]);
    fromSegment = collect(); let terminated = false;
    assert(dynamicSegment.filesz / 16 <= 65536, 'ELF_DYNAMIC_TABLE_BOUND');
    for (let at = dynamicSegment.offset; at + 16 <= dynamicSegment.offset + dynamicSegment.filesz; at += 16) {
      const tag = buffer.readBigInt64LE(at); const value = buffer.readBigUInt64LE(at + 8);
      if (tag === 0n) { terminated = true; break; }
      if (tag === 1n) tags.needed.push(value);
      else if (tag === 15n) fromSegment.rpath = true;
      else if (tag === 29n) fromSegment.runpath = true;
      // A value beyond 2^53 cannot be located exactly: it stays NaN and leaves the table unresolved.
      else if (tagNames.has(tag)) tags[tagNames.get(tag)] = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Number.NaN;
    }
    assert(terminated, 'ELF_UNTERMINATED_DYNAMIC_TABLE');
    segmentSymtab = tags.symtab !== null;
    const strtabOffset = tags.strtab === null || tags.strsz === null ? null : resolve(tags.strtab, tags.strsz);
    const strings = strtabOffset === null ? null : range(strtabOffset, tags.strsz);
    if ((tags.needed.length || tags.symtab !== null) && !strings) unresolved = true;
    if (strings) {
      segmentStrings = true;
      for (const value of tags.needed) addNeeded(fromSegment, strings, value);
      if (fromSegment.neededUnresolved) unresolved = true;
    }
    const word = at => buffer.readUInt32LE(at);
    // DT_HASH: every bucket and chain entry must index a symbol below nchain. No bucket
    // (nbucket 0) is valid only with nchain 1, the null symbol alone: nothing can be looked
    // up (a static-pie such as sentry-cli); the cross-checks below must agree with 1 entry.
    const sysvCount = () => {
      const head = resolve(tags.hash, 8); if (head === null) return null;
      const nbucket = word(head); const nchain = word(head + 4);
      if ((nbucket === 0 && nchain !== 1) || nbucket > 1048576 || nchain === 0 || nchain > 500000) return null; // index 0 always exists
      const at = resolve(tags.hash, 8 + 4 * (nbucket + nchain)); if (at === null) return null;
      for (let index = 0; index < nbucket + nchain; index += 1) {
        const value = word(at + 8 + 4 * index); if (value !== 0 && value >= nchain) return null;
      }
      return { count: nchain, exact: true };
    };
    // DT_GNU_HASH: a power-of-two bloom filter, buckets at or above symoffset (>= 1, the
    // null symbol is never hashed), and a chain that ends inside the table. The whole table,
    // header to chain end, must lie in the PT_LOAD that holds its start. Without any hashed
    // symbol it only gives a lower bound.
    const gnuCount = () => {
      const segment = Number.isSafeInteger(tags.gnuHash)
        ? loads.find(item => tags.gnuHash >= item.vaddr && tags.gnuHash < item.vaddr + item.filesz) : null;
      if (!segment) return null;
      const within = (vaddr, size) => (Number.isSafeInteger(vaddr + size) && vaddr >= segment.vaddr
        && vaddr + size <= segment.vaddr + segment.filesz ? segment.offset + (vaddr - segment.vaddr) : null);
      const head = within(tags.gnuHash, 16); if (head === null) return null;
      const nbuckets = word(head); const symoffset = word(head + 4); const bloomSize = word(head + 8);
      if (nbuckets === 0 || nbuckets > 1048576 || symoffset === 0 || symoffset > 500000 || bloomSize === 0
        || bloomSize > 1048576 || (bloomSize & (bloomSize - 1)) !== 0) return null;
      const bucketsVaddr = tags.gnuHash + 16 + bloomSize * 8;
      const bucketsAt = within(tags.gnuHash, 16 + bloomSize * 8 + nbuckets * 4); if (bucketsAt === null) return null;
      const bucketBase = bucketsAt + 16 + bloomSize * 8;
      let last = -1;
      for (let index = 0; index < nbuckets; index += 1) {
        const value = word(bucketBase + index * 4); if (value === 0) continue;
        if (value < symoffset) return null;
        last = Math.max(last, value);
      }
      if (last < 0) return { count: symoffset, exact: false };
      let index = last;
      for (;;) {
        const at = within(bucketsVaddr + nbuckets * 4 + (index - symoffset) * 4, 4); if (at === null) return null;
        const value = word(at); index += 1;
        if (value & 1) return { count: index, exact: true };
        if (index > 500000) return null;
      }
    };
    // The highest symbol index any relocation refers to (-1 for none); the loader binds
    // imports through these, so the symbol table is never read shorter than this.
    const relocationMax = () => {
      let max = -1;
      const scan = (vaddr, size, entry, rela) => {
        if (vaddr === null && size === null) return true;
        if (vaddr === null || size === null || rela === null) return false;
        const width = rela ? 24 : 16;
        if ((entry !== null && entry !== width) || size % width !== 0 || size / width > 4000000) return false;
        const at = resolve(vaddr, size); if (at === null) return false;
        for (let offset = 0; offset < size; offset += width) {
          max = Math.max(max, Number(buffer.readBigUInt64LE(at + offset + 8) >> 32n));
        }
        return true;
      };
      const pltRela = tags.pltrel === 7 ? true : (tags.pltrel === 17 ? false : null);
      const ok = scan(tags.rela, tags.relasz, tags.relaent, true) && scan(tags.rel, tags.relsz, tags.relent, false)
        && (tags.jmprel === null && tags.pltrelsz === null ? true : scan(tags.jmprel, tags.pltrelsz, null, pltRela));
      return ok ? max : null;
    };
    // Required tags first: when anything refers to symbols (a hash table, symbol versions,
    // a .dynsym section or a relocation naming a symbol), DT_SYMTAB, DT_STRTAB, DT_STRSZ and
    // DT_SYMENT (24) must all be present, and relocation tables must be readable.
    const relocationsMax = relocationMax();
    if (relocationsMax === null) unresolved = true;
    const usesSymbols = tags.hash !== null || tags.gnuHash !== null || tags.versym !== null || tags.verneed !== null
      || tags.verdef !== null || symbolSections.length > 0 || (relocationsMax ?? 0) > 0;
    if ((usesSymbols || tags.symtab !== null)
      && (tags.symtab === null || tags.strtab === null || tags.strsz === null || tags.syment !== 24)) unresolved = true;
    if (tags.symtab !== null && strings) {
      // The symbol count is cross-checked: the hash tables (each valid, exact counts equal),
      // the relocations (a lower bound), the distance from DT_SYMTAB to a following
      // DT_STRTAB (an upper bound) and a .dynsym section, which must sit where DT_SYMTAB
      // points. Any disagreement leaves the table unresolved. Without a section an exact
      // hash count is used as a lower bound and reported as such.
      let consistent = tags.syment === 24;
      const evidence = [];
      if (tags.hash !== null) { const result = sysvCount(); if (result) evidence.push(result); else consistent = false; }
      if (tags.gnuHash !== null) { const result = gnuCount(); if (result) evidence.push(result); else consistent = false; }
      const relocations = relocationsMax; if (relocations === null) consistent = false;
      const exact = [...new Set(evidence.filter(item => item.exact).map(item => item.count))];
      if (exact.length > 1) consistent = false;
      const lower = Math.max(0, (relocations ?? -1) + 1, ...evidence.map(item => item.count));
      if (exact.length && exact[0] < lower) consistent = false;
      const upper = tags.strtab > tags.symtab ? Math.floor((tags.strtab - tags.symtab) / 24) : null;
      const section = symbolSections.length === 1 ? symbolSections[0] : null;
      let count = null;
      if (section) {
        const sectionCount = section.size / 24;
        assert(resolve(tags.symtab, section.size) === section.offset, 'ELF_DYNAMIC_MISMATCH');
        if ((exact.length && exact[0] !== sectionCount) || sectionCount < lower) consistent = false;
        count = sectionCount; countBasis = 'section';
      } else if (exact.length) {
        count = Math.max(exact[0], lower); countBasis = 'hash'; lowerBound = true;
      }
      if (count !== null && upper !== null && count > upper) consistent = false;
      symtabOffset = count === null ? null : resolve(tags.symtab, count * 24);
      if (!consistent || count === null || symtabOffset === null) unresolved = true;
      else {
        assert(count <= 500000, 'ELF_SYMBOL_TABLE_BOUND');
        segmentSymbols = true;
        for (let index = 1; index < count; index += 1) {
          const at = symtabOffset + index * 24; const offset = buffer.readUInt32LE(at); if (!offset) continue;
          addSymbol(fromSegment, string(strings, offset), buffer.readUInt16LE(at + 6) !== 0);
        }
      }
    }
    // Section tables that exist must describe the same dynamic data as PT_DYNAMIC.
    const sameSet = (a, b) => a.size === b.size && [...a].every(item => b.has(item));
    if (dynamicSections.length === 1) {
      assert(dynamicSections[0].offset === dynamicSegment.offset, 'ELF_DYNAMIC_MISMATCH');
      if (strings) assert(sameSet(fromSections.needed, fromSegment.needed)
        && fromSections.nonBasenameNeeded === fromSegment.nonBasenameNeeded, 'ELF_DYNAMIC_MISMATCH');
    }
    if (symbolSections.length === 1 && segmentSymbols) {
      assert(symbolSections[0].offset === symtabOffset && sameSet(fromSections.imports, fromSegment.imports)
        && sameSet(fromSections.exports, fromSegment.exports), 'ELF_DYNAMIC_MISMATCH');
    }
  }
  if (!fromSegment && fromSections.neededUnresolved) unresolved = true;
  // What PT_DYNAMIC resolved is reported from it; anything it could not resolve falls back
  // to the section tables and the row is marked unresolved.
  const linked = fromSegment && segmentStrings ? fromSegment : fromSections;
  const symbols = fromSegment && (segmentSymbols || !segmentSymtab) && segmentStrings ? fromSegment : fromSections;
  return { elf_class: 64, byte_order: 'little', machine: buffer.readUInt16LE(18),
    dynamic_source: fromSegment ? 'program_headers' : (symbolSections.length || dynamicSections.length ? 'sections' : 'none'),
    dynamic_unresolved: unresolved,
    symbol_count_basis: segmentSymbols ? countBasis : null, dynamic_symbols_lower_bound: segmentSymbols && lowerBound,
    dynamic_symbol_table: fromSegment ? segmentSymtab : symbolSections.length === 1,
    dynamic_table: Boolean(dynamicSegment) || dynamicSections.length === 1,
    dynamic_symbols: symbols.symbols, needed: [...linked.needed].sort(), non_basename_needed: linked.nonBasenameNeeded,
    has_rpath: (fromSegment || fromSections).rpath, has_runpath: (fromSegment || fromSections).runpath,
    risk_imports: [...symbols.imports].sort(), risk_exports: [...symbols.exports].sort() };
}

const PAGE_SIZE = 4096; // amd64
const APP_ROOT = '/app';
const ROOTS = Object.freeze(['/app/node_modules', '/app/apps', '/app/libraries']);

// Fixed roots for the image; the parameters exist only for the contract test's
// temporary trees and are never taken from the command line or the environment.
export function inventory(roots = ROOTS, appRoot = APP_ROOT) {
  const maxFiles = 250000; const maxElfs = 4000; const maxFileBytes = 256 * 1024 * 1024;
  const maxBytes = 4 * 1024 * 1024 * 1024; const started = Date.now();
  const visitedDirectories = new Set(); const visitedFiles = new Set(); const rows = []; const errors = new Map();
  let files = 0; let bytes = 0; let elfs = 0; let symlinksOutside = 0; let boundStopped = false; let neededOmitted = 0; let dynamicUnresolved = 0; let lowerBoundRows = 0;
  let danglingSymlinks = 0;
  const error = code => errors.set(code, (errors.get(code) || 0) + 1);
  // Symlinks are followed anywhere inside the app (pnpm workspace links, .pnpm store);
  // a target outside the app is counted and makes the inventory incomplete.
  const allowed = resolved => resolved === appRoot || resolved.startsWith(appRoot + '/');
  const scopeOf = resolved => roots.find(root => resolved === root || resolved.startsWith(root + '/')) || appRoot;
  // The wall clock only stops a runaway walk. Hosted publisher runs take 29-46 s
  // (one stopped at 46 s under 45 s); the count and byte bounds stay as they were.
  const bound = () => {
    if (files >= maxFiles || elfs >= maxElfs || bytes >= maxBytes || Date.now() - started > 120000) { boundStopped = true; throw new Error('INVENTORY_BOUND'); }
  };
  // A path that realpath could not find (ENOENT) is a dangling symlink only when lstat
  // shows a link, readlink reads it and its target, resolved component by component as the
  // kernel does (a link component replaced by its target, at most 40 links; '..' taken from
  // the real directory reached so far), stops at a missing component (ENOENT) inside the app
  // with no '..' after it: 'inside'. 'outside' as soon as a component reached lies outside
  // the app (an ancestor of the app root is only walked through, as by an absolute target).
  // Anything else (not a link, another error, a component that is not a directory, a target
  // that exists after all) is null and stays PATH_UNREADABLE. Every link target is read as
  // bytes and must be valid UTF-8: decoded, an invalid name becomes another one (U+FFFD)
  // whose lstat fails although the real target exists, so such a link is never classified.
  // The components looked up are then those bytes exactly.
  const danglingTarget = item => {
    try {
      if (!fs.lstatSync(item).isSymbolicLink()) return null;
      let base = fs.realpathSync(path.dirname(item)); let links = 1;
      const follow = link => {
        const bytes = fs.readlinkSync(link, { encoding: 'buffer' }); const target = bytes.toString('utf8');
        if (!Buffer.from(target, 'utf8').equals(bytes)) throw new Error('LINK_TARGET_NOT_UTF8'); // caught below: null
        if (target.startsWith('/')) base = '/';
        return target.split('/');
      };
      let parts = follow(item);
      while (parts.length) {
        const part = parts.shift();
        if (part === '' || part === '.') continue;
        if (part === '..') { base = path.dirname(base); continue; }
        const next = path.join(base, part);
        if (!allowed(next) && !appRoot.startsWith(next + '/')) return 'outside';
        let stat;
        try { stat = fs.lstatSync(next); } catch (failure) {
          return failure.code === 'ENOENT' && allowed(next) && !parts.includes('..') ? 'inside' : null;
        }
        if (stat.isSymbolicLink()) { links += 1; if (links > 40) return null; parts = [...follow(next), ...parts]; continue; }
        if (!stat.isDirectory() && parts.some(rest => rest !== '' && rest !== '.')) return null;
        base = next;
      }
      return null;
    } catch { return null; }
  };
  const visit = item => {
    bound(); let resolved; let stat;
    try { resolved = fs.realpathSync(item); } catch (failure) {
      // A dangling symlink has nothing behind it to read and cannot hide a library: it is
      // counted apart, not as an error. One whose target lies outside the app is counted
      // as outside, as a resolved one would be.
      const dangling = failure && failure.code === 'ENOENT' ? danglingTarget(item) : null;
      if (dangling === 'inside') danglingSymlinks += 1;
      else if (dangling === 'outside') symlinksOutside += 1;
      else error('PATH_UNREADABLE');
      return;
    }
    try { if (!allowed(resolved)) { symlinksOutside += 1; return; } stat = fs.statSync(resolved); }
    catch { error('PATH_UNREADABLE'); return; }
    const identity = stat.dev + ':' + stat.ino;
    if (stat.isDirectory()) {
      if (visitedDirectories.has(identity)) return; visitedDirectories.add(identity);
      let entries; try { entries = fs.readdirSync(resolved, { encoding: 'buffer' }); } catch { error('DIRECTORY_UNREADABLE'); return; }
      // Names are read as bytes. One that is not valid UTF-8 has no exact string path: decoded,
      // it becomes another name (U+FFFD), possibly a sibling's. It is counted as unreadable and
      // never visited under the decoded name; the valid names are visited in the same order.
      const names = [];
      for (const bytes of entries) {
        const name = bytes.toString('utf8');
        if (Buffer.from(name, 'utf8').equals(bytes)) names.push(name); else error('PATH_UNREADABLE');
      }
      for (const name of names.sort()) visit(path.join(resolved, name));
      return;
    }
    if (!stat.isFile() || visitedFiles.has(identity)) return;
    visitedFiles.add(identity); files += 1; let fd;
    try {
      fd = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const actual = fs.fstatSync(fd); assert(actual.dev === stat.dev && actual.ino === stat.ino && actual.size === stat.size, 'FILE_CHANGED');
      const magic = Buffer.alloc(4); if (fs.readSync(fd, magic, 0, 4, 0) !== 4 || !magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return;
      elfs += 1; assert(actual.size <= maxFileBytes && bytes + actual.size <= maxBytes, 'ELF_FILE_SIZE_BOUND');
      const buffer = Buffer.alloc(actual.size); let offset = 0;
      while (offset < buffer.length) { const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); assert(read > 0, 'ELF_SHORT_READ'); offset += read; }
      bytes += buffer.length;
      const after = fs.fstatSync(fd); assert(after.size === actual.size && after.mtimeMs === actual.mtimeMs, 'FILE_CHANGED');
      const row = { scope: scopeOf(resolved),
        relative_path_sha256: sha(path.relative(appRoot, resolved)), content_sha256: sha(buffer), bytes: buffer.length,
        addon_filename: resolved.endsWith('.node'), executable: Boolean(actual.mode & 0o111), setuid: Boolean(actual.mode & 0o4000),
        ...elfInventory(buffer) };
      if (row.non_basename_needed) neededOmitted += 1;
      if (row.dynamic_unresolved) dynamicUnresolved += 1;
      if (row.dynamic_symbols_lower_bound) lowerBoundRows += 1;
      rows.push(row);
    } catch (failure) {
      error(errorCodeOf(failure)); // every failure is counted; nothing is swallowed
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const present = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue; present.push(root);
    try { visit(root); } catch (failure) { error(failure.message === 'INVENTORY_BOUND' ? 'INVENTORY_BOUND' : 'TRAVERSAL_FAILED'); break; }
  }
  // Complete only when the observation itself is whole: every declared root present,
  // at least one ELF read (the Postiz image always carries native addons), nothing
  // unreadable, bounded or outside the app, no DT_NEEDED omitted from the rows, and
  // every PT_DYNAMIC resolved. Dangling symlinks inside the app are counted, not errors.
  const missing = roots.filter(root => !present.includes(root));
  const incomplete = [];
  if (missing.length) incomplete.push('ROOT_MISSING');
  if (elfs < 1 || rows.length < 1) incomplete.push('NO_ELF_OBSERVED');
  if (boundStopped) incomplete.push('INVENTORY_BOUND');
  if (errors.size) incomplete.push('ERRORS');
  if (symlinksOutside) incomplete.push('SYMLINK_OUTSIDE_APP');
  if (neededOmitted) incomplete.push('NEEDED_OMITTED');
  if (dynamicUnresolved) incomplete.push('DYNAMIC_UNRESOLVED');
  const complete = incomplete.length === 0;
  const limitations = ['No function execution/reachability or exploitability verdict', 'No static archives, JIT/WASM/JS dynamic caller proof',
    'No dynamic linker search-order resolution or running process maps', 'No system package tree unless copied under declared app roots',
    'Absence of a dynamic import never proves non-use or TAC acceptance'];
  if (neededOmitted) limitations.push(`DT_NEEDED entries that are not plain library names were omitted from ${neededOmitted} row(s); those dependencies are not recorded`);
  if (lowerBoundRows) limitations.push(`The dynamic symbol count of ${lowerBoundRows} row(s) has no .dynsym section to confirm it; the hash tables and relocations give a lower bound, read in full`);
  if (dynamicUnresolved) limitations.push(`The PT_DYNAMIC table of ${dynamicUnresolved} row(s) could not be resolved; their needed libraries and symbols may be missing`);
  if (danglingSymlinks) limitations.push(`${danglingSymlinks} symlink(s) inside the app point to a path that does not exist; nothing was read behind them, and a file created there later is not in this inventory`);
  return { scope: 'POSTIZ_APP_ELF_DYNAMIC_INVENTORY_ONLY', roots_declared: [...roots], roots_present: present, roots_missing: missing,
    files_observed: files, elfs_observed: elfs, bytes_read: bytes, symlinks_outside_scope: symlinksOutside, dangling_symlinks: danglingSymlinks,
    needed_omitted_rows: neededOmitted, dynamic_unresolved_rows: dynamicUnresolved, symbol_lower_bound_rows: lowerBoundRows, errors: Object.fromEntries(errors), incomplete_reasons: incomplete,
    complete_in_declared_scope: complete, rows, limitations, paid_resource_or_role_created: false };
}

// A thrown failure as a code: the observer's own codes as they are, anything else (a
// RangeError, a TypeError) as ELF_UNREADABLE. Either way the inventory is incomplete.
export function errorCodeOf(failure) {
  return /^[A-Z][A-Z0-9_]+$/.test((failure && failure.message) || '') ? failure.message : 'ELF_UNREADABLE';
}

// 0 only for an inventory complete in the declared scope; 2 for anything else.
export function exitCodeFor(result) {
  return result && result.complete_in_declared_scope === true ? 0 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { const result = inventory(); console.log(JSON.stringify(result)); process.exitCode = exitCodeFor(result); }
  catch { console.log(JSON.stringify({ scope: 'POSTIZ_APP_ELF_DYNAMIC_INVENTORY_ONLY', complete_in_declared_scope: false, failure: 'OBSERVER_FAILED' })); process.exitCode = 2; }
}
