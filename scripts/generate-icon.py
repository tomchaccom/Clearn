#!/usr/bin/env python3
"""Clearn 앱 아이콘 생성 스크립트 (외부 라이브러리 없음)
Usage: python3 scripts/generate-icon.py
"""
import struct, zlib, math, subprocess, os

def write_png(filename, width, height, pixels):
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            raw += bytes([r, g, b, a])
    png  = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6))
    png += chunk(b'IEND', b'')
    with open(filename, 'wb') as f:
        f.write(png)

def make_icon(size=1024):
    pixels = []
    cx, cy = size / 2, size / 2
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            cdx = max(0, abs(dx) - size * 0.22)
            cdy = max(0, abs(dy) - size * 0.22)
            in_shape = (cdx*cdx + cdy*cdy <= (size*0.22)**2) or \
                       (abs(dx) <= size*0.44 and abs(dy) <= size*0.22) or \
                       (abs(dx) <= size*0.22 and abs(dy) <= size*0.44)
            if not in_shape:
                pixels.append((20, 18, 15, 0))
                continue
            r, g, b, a = 217, 119, 87, 255
            dx2, dy2 = x - (cx - size*0.01), y - cy
            d2 = math.hypot(dx2, dy2)
            ro, ri = size * 0.295, size * 0.165
            angle = math.atan2(dy2, dx2)
            if ri < d2 < ro and not (-math.pi*0.32 < angle < math.pi*0.32):
                t = min(1.0, min(d2 - ri, ro - d2) / (size * 0.014))
                r = int(245*t + 217*(1-t)); g = int(240*t + 119*(1-t)); b = int(235*t + 87*(1-t))
            pixels.append((r, g, b, a))
    return pixels

if __name__ == '__main__':
    os.makedirs('build/icon.iconset', exist_ok=True)
    print('아이콘 생성 중...')
    write_png('build/icon.png', 1024, 1024, make_icon(1024))
    for size in [16, 32, 128, 256, 512]:
        subprocess.run(['sips', '-z', str(size), str(size), 'build/icon.png', '--out', f'build/icon.iconset/icon_{size}x{size}.png'], capture_output=True)
        d = size * 2
        subprocess.run(['sips', '-z', str(d), str(d), 'build/icon.png', '--out', f'build/icon.iconset/icon_{size}x{size}@2x.png'], capture_output=True)
    subprocess.run(['iconutil', '-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns'])
    print('완료: build/icon.png, build/icon.icns')
