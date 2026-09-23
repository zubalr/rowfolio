#!/usr/bin/env python3
"""Independent native-file inspector — Python stdlib only.

Third implementation layer (alongside tooling/test/inspect.ts and the
production parsers): validates ZIP/OOXML/CFB structure with zipfile +
xml.etree so a verdict never relies on the same library under test.

Usage:
    python3 tooling/test/inspect_native.py <file...> [--json] [--require-clean]
"""
from __future__ import annotations

import hashlib
import json
import re
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
POLICY = json.loads((REPO / 'packages/contracts/source/policy.json').read_text())
LIMITS = POLICY['limits']

CFB_SIG = bytes.fromhex('d0cf11e0a1b11ae1')
ARCHIVE_EXT = re.compile(r'\.(zip|jar|xlsx|xlsm|pptx|docx|ods|odt|epub|apk)$', re.I)
MACRO_PART = re.compile(r'vbaProject|activeX|ctrlProp', re.I)
EXTERNAL_LINK_PART = re.compile(r'externalLinks?/', re.I)
RELS_RE = re.compile(r'(^|/)_rels/[^/]+\.rels$')


def _f(code, severity, detail, path=None):
    out = {'code': code, 'severity': severity, 'detail': detail}
    if path:
        out['path'] = path
    return out


def _resolve_target(rels_name: str, target: str):
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
        return None
    owner_dir = re.sub(r'(^|/)_rels/[^/]+\.rels$', r'\1', rels_name)
    joined = target[1:] if target.startswith('/') else owner_dir + target
    out = []
    for seg in joined.split('/'):
        if seg in ('', '.'):
            continue
        if seg == '..':
            if not out:
                return None
            out.pop()
            continue
        out.append(seg)
    return '/'.join(out)


def inspect_cfb(data: bytes, findings: list) -> dict:
    findings.append(_f('cfb.compound-file', 'error', 'OLE2/CFB container (encrypted or legacy binary Office format)'))
    names = []
    if len(data) >= 512:
        sector_shift = struct.unpack_from('<H', data, 30)[0]
        sector_size = 1 << sector_shift if sector_shift in (9, 12) else 0
        if sector_size:
            num_fat = struct.unpack_from('<I', data, 44)[0]
            first_dir = struct.unpack_from('<I', data, 48)[0]
            difat = [struct.unpack_from('<I', data, 76 + i * 4)[0] for i in range(109)]
            fat_secs = [s for s in difat if s not in (0xFFFFFFFF, 0xFFFFFFFE)][:num_fat]
            fat = []
            for s in fat_secs:
                off = 512 + s * sector_size
                fat.extend(struct.unpack_from('<%dI' % (sector_size // 4), data, off))
            cur, seen, dirb = first_dir, set(), bytearray()
            while cur not in (0xFFFFFFFE, 0xFFFFFFFF) and cur < len(fat) and cur not in seen:
                seen.add(cur)
                off = 512 + cur * sector_size
                dirb += data[off:off + sector_size]
                cur = fat[cur]
            for off in range(0, len(dirb) - 127, 128):
                nlen = struct.unpack_from('<H', dirb, off + 64)[0]
                otype = dirb[off + 66]
                if nlen < 2 or nlen > 64 or otype == 0:
                    continue
                name = dirb[off:off + nlen - 2].decode('utf-16-le', errors='replace')
                names.append(name)
                if name in ('EncryptionInfo', 'EncryptedPackage'):
                    findings.append(_f('cfb.encryption-marker', 'error', 'encryption stream %r present' % name, name))
                if name in ('PowerPoint Document', 'Workbook', 'Book', 'WordDocument'):
                    findings.append(_f('cfb.legacy-binary', 'error', 'legacy binary stream %r' % name, name))
    return {'kind': 'cfb', 'streams': names}


def inspect_zip(data: bytes, findings: list) -> dict:
    try:
        zf = zipfile.ZipFile(__import__('io').BytesIO(data))
    except zipfile.BadZipFile as e:
        findings.append(_f('zip.no-eocd', 'error', 'zipfile rejected archive: %s' % e))
        return {'kind': 'unknown', 'entries': []}
    infos = zf.infolist()
    names = [i.filename for i in infos]

    # EOCD-declared entry count vs records actually parsed — zipfile won't
    # surface this itself.
    eocd_pos = data.rfind(b'PK\x05\x06', max(0, len(data) - (22 + 0xFFFF)))
    if eocd_pos >= 0 and eocd_pos + 22 <= len(data):
        declared = struct.unpack_from('<H', data, eocd_pos + 10)[0]
        if declared > LIMITS['entries']:
            findings.append(_f('zip.entry-count', 'error',
                               'declared %d entries exceeds limit %d' % (declared, LIMITS['entries'])))
        if declared != len(infos):
            findings.append(_f('zip.cd-count-mismatch', 'error',
                               'EOCD declares %d entries but %d records parsed' % (declared, len(infos))))
    if len(infos) > LIMITS['entries']:
        findings.append(_f('zip.entry-count', 'error', '%d entries exceeds limit %d' % (len(infos), LIMITS['entries'])))
    expanded = 0
    for i in infos:
        n = i.filename
        if n.startswith('/') or '..' in n.split('/') or '\\' in n or re.match(r'^[a-zA-Z]:', n):
            findings.append(_f('zip.path-traversal', 'error', 'unsafe archive path', n))
        if i.flag_bits & 0x1:
            findings.append(_f('zip.encrypted-entry', 'error', 'general-purpose flag bit 0 set', n))
        if i.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            findings.append(_f('zip.unsupported-method', 'error', 'compression method %d' % i.compress_type, n))
        if i.file_size > LIMITS['entryBytes']:
            findings.append(_f('zip.entry-declared-oversize', 'error', 'declared %d B over limit' % i.file_size, n))
        if ARCHIVE_EXT.search(n):
            findings.append(_f('zip.nested-archive', 'warning', 'nested archive member', n))
        expanded += i.file_size
    if len(names) != len(set(names)):
        findings.append(_f('zip.duplicate-entry', 'error', 'duplicate entry name'))
    if expanded > LIMITS['expandedBytes']:
        findings.append(_f('zip.expanded-exceeds-limit', 'error', 'declared expansion %d over limit' % expanded))
    if len(data) and expanded / len(data) > LIMITS['expansionRatio']:
        findings.append(_f('zip.expansion-ratio', 'error', 'ratio %.1f over limit %d' % (expanded / len(data), LIMITS['expansionRatio'])))
    if not infos:
        findings.append(_f('zip.empty-archive', 'warning', 'archive declares zero entries'))

    for i in infos:
        if i.flag_bits & 0x1 or i.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            continue
        if i.file_size > LIMITS['entryBytes']:
            findings.append(_f('zip.inflate-skipped', 'error',
                               'refusing to inflate %d B (over limit)' % i.file_size, i.filename))
            continue
        try:
            zf.read(i)
        except (zipfile.BadZipFile, RuntimeError) as e:
            findings.append(_f('zip.crc-mismatch', 'error', 'read failed: %s' % e, i.filename))

    if '[Content_Types].xml' not in names:
        findings.append(_f('ooxml.missing-content-types', 'warning', 'plain ZIP, not an OOXML package'))
        return {'kind': 'zip-generic', 'entries': names}

    ct = zf.read('[Content_Types].xml')
    ct_text = ct.decode('utf-8', 'replace')
    if 'macroEnabled' in ct_text:
        findings.append(_f('ooxml.macro-content', 'error', 'macroEnabled content type', '[Content_Types].xml'))
    kind = ('ooxml-xlsx' if 'spreadsheetml' in ct_text
            else 'ooxml-pptx' if 'presentationml' in ct_text else 'ooxml-other')
    if kind == 'ooxml-xlsx' and 'xl/workbook.xml' not in names:
        findings.append(_f('ooxml.missing-main-part', 'error', 'xl/workbook.xml absent'))
    if kind == 'ooxml-pptx' and 'ppt/presentation.xml' not in names:
        findings.append(_f('ooxml.missing-main-part', 'error', 'ppt/presentation.xml absent'))

    for n in names:
        if MACRO_PART.search(n):
            findings.append(_f('ooxml.macro-part', 'error', 'macro/ActiveX part', n))
        elif EXTERNAL_LINK_PART.search(n):
            findings.append(_f('ooxml.external-link-part', 'warning', 'externalLink part', n))

    for n in names:
        if not RELS_RE.search(n):
            continue
        try:
            root = ET.fromstring(zf.read(n))
        except (ET.ParseError, KeyError, zipfile.BadZipFile) as e:
            findings.append(_f('ooxml.bad-xml', 'error', str(e), n))
            continue
        for rel in root.iter():
            if not rel.tag.endswith('Relationship'):
                continue
            target = rel.get('Target', '')
            mode = rel.get('TargetMode')
            rid = rel.get('Id', '?')
            if mode == 'External' or _resolve_target(n, target) is None:
                findings.append(_f('ooxml.external-relationship', 'error',
                                   'relationship %s targets external %r' % (rid, target), n))
            else:
                resolved = _resolve_target(n, target)
                if resolved is not None and resolved not in names:
                    findings.append(_f('ooxml.unresolved-relationship', 'error',
                                       'relationship %s -> missing %r' % (rid, resolved), n))
    return {'kind': kind, 'entries': names}


def inspect_file(path) -> dict:
    data = Path(path).read_bytes()
    findings: list = []
    report = {
        'file': str(path),
        'byteLength': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
    }
    if data[:8] == CFB_SIG:
        report.update(inspect_cfb(data, findings))
    elif data[:2] == b'PK':
        report.update(inspect_zip(data, findings))
    else:
        findings.append(_f('inspect.unknown-signature', 'error', 'not a ZIP (PK) or OLE2/CFB signature'))
        report['kind'] = 'unknown'
    # de-dup identical findings
    seen, uniq = set(), []
    for f in findings:
        k = (f['code'], f.get('path'), f['detail'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(f)
    report['findings'] = uniq
    report['ok'] = not any(f['severity'] == 'error' for f in uniq)
    return report


def main(argv) -> int:
    files, require_clean = [], False
    for a in argv:
        if a == '--require-clean':
            require_clean = True
        elif a == '--json':
            pass
        else:
            files.append(a)
    if not files:
        print('usage: inspect_native.py <file...> [--require-clean]', file=sys.stderr)
        return 2
    reports = [inspect_file(f) for f in files]
    for r in reports:
        print(json.dumps(r, indent=2))
    bad = [r for r in reports if not r['ok']]
    if require_clean and bad:
        print('FAIL %d/%d produced error findings' % (len(bad), len(reports)), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
