import struct
import zlib

def create_simple_png(width, height, r=10, g=132, b=255):
    # Minimal valid PNG generator without third-party dependencies
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) # 8-bit RGBA
    
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0) # filter type none
        for x in range(width):
            # Draw rounded box / mail icon pattern
            dx = x - width / 2
            dy = y - height / 2
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < width * 0.45:
                raw_data.extend([r, g, b, 255])
            else:
                raw_data.extend([0, 0, 0, 0])

    idat = chunk(b'IDAT', zlib.compress(bytes(raw_data)))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def create_ico(filename):
    png_data = create_simple_png(256, 256)
    
    # ICONDIR: reserved (0), type (1), count (1)
    icondir = struct.pack('<HHH', 0, 1, 1)
    
    # ICONDIRENTRY: width (0=256), height (0=256), colors (0), reserved (0), planes (1), bpp (32), bytes, offset
    offset = 6 + 16
    entry = struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png_data), offset)
    
    with open(filename, 'wb') as f:
        f.write(icondir + entry + png_data)
    print(f'Successfully generated {filename}')

if __name__ == '__main__':
    create_ico('build/icon.ico')
