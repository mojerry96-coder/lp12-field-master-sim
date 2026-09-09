"""Resize every embedded texture in a GLB and rewrite it.

Blender's exporter writes the ORIGINAL packed bytes for an unmodified image, so
scaling in Blender does not survive the export. Doing it here is deterministic:
the geometry is passed through byte for byte and only the image bufferViews are
replaced, with every bufferView offset relaid afterwards.
"""
import struct, json, sys, io
from PIL import Image

src, dst, cap = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = open(src,'rb').read()
magic, ver, length = struct.unpack('<III', d[:12])
assert magic == 0x46546C67, "not a GLB"
off, js, bin_ = 12, None, b''
while off < length:
    clen, ctype = struct.unpack('<II', d[off:off+8])
    payload = d[off+8:off+8+clen]
    if ctype == 0x4E4F534A: js = json.loads(payload)
    elif ctype == 0x004E4942: bin_ = payload
    off += 8 + clen

bvs = js['bufferViews']
chunks = [bytearray(bin_[bv.get('byteOffset',0): bv.get('byteOffset',0)+bv['byteLength']]) for bv in bvs]

saved = 0
for im in js.get('images', []):
    if 'bufferView' not in im: continue
    i = im['bufferView']
    raw = bytes(chunks[i])
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        print("  skip (undecodable)", im.get('name'), e); continue
    w, h = img.size
    if max(w, h) <= cap: continue
    k = cap / max(w, h)
    img = img.resize((max(1,int(w*k)), max(1,int(h*k))), Image.LANCZOS)
    has_alpha = img.mode in ('RGBA','LA') and img.getchannel('A').getextrema()[0] < 255
    buf = io.BytesIO()
    if has_alpha:
        img.save(buf, format='PNG', optimize=True); mime = 'image/png'
    else:
        img.convert('RGB').save(buf, format='JPEG', quality=82, optimize=True); mime = 'image/jpeg'
    new = buf.getvalue()
    print(f"  {im.get('name','?')[:38]:38s} {w}x{h} {len(raw)/1024:8.1f}KB -> "
          f"{img.size[0]}x{img.size[1]} {len(new)/1024:7.1f}KB")
    saved += len(raw) - len(new)
    chunks[i] = bytearray(new)
    im['mimeType'] = mime

# relay out every bufferView, 4-byte aligned
out = bytearray(); 
for i, bv in enumerate(bvs):
    while len(out) % 4: out.append(0)
    bv['byteOffset'] = len(out)
    bv['byteLength'] = len(chunks[i])
    out += chunks[i]
while len(out) % 4: out.append(0)
js['buffers'] = [{'byteLength': len(out)}]

jb = json.dumps(js, separators=(',',':')).encode()
while len(jb) % 4: jb += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8+len(jb) + 8+len(out))
glb += struct.pack('<II', len(jb), 0x4E4F534A) + jb
glb += struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst,'wb').write(glb)
print(f"saved {saved/1e6:.2f} MB   {len(d)/1e6:.2f} MB -> {len(glb)/1e6:.2f} MB")
