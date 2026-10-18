import os
import struct
import zlib
import math

def create_png_image(width, height, draw_func):
    """Generate a raw RGBA PNG using standard Python libraries"""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) # 8-bit RGBA
    
    raw = bytearray()
    for y in range(height):
        raw.append(0) # filter type none
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            raw.extend([int(r), int(g), int(b), int(a)])
            
    idat = chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def draw_email_to_folder_icon(x, y, w, h):
    # Normalized coordinates 0.0 to 1.0
    nx = x / float(w)
    ny = y / float(h)
    
    # Rounded rectangle (Squircle) boundary
    # Center is at 0.5, 0.5
    cx = abs(nx - 0.5)
    cy = abs(ny - 0.5)
    
    # Corner radius approx 22%
    radius = 0.22
    rect_w = 0.44
    rect_h = 0.44
    
    # Distance from rounded box
    dx = max(0.0, cx - (rect_w - radius))
    dy = max(0.0, cy - (rect_h - radius))
    dist = math.sqrt(dx*dx + dy*dy)
    
    is_inside_corner = (cx > rect_w - radius and cy > rect_h - radius)
    in_box = (cx <= rect_w and cy <= rect_h and (not is_inside_corner or dist <= radius))
    
    if not in_box:
        # Anti-aliasing border
        if is_inside_corner and dist <= radius + 0.015:
            alpha = max(0.0, min(1.0, (radius + 0.015 - dist) / 0.015))
            # Gradient color
            t = (nx + ny) / 2.0
            r = int(10 + t * (138 - 10))
            g = int(132 + t * (92 - 132))
            b = 255
            return r, g, b, int(alpha * 255)
        return 0, 0, 0, 0

    # Gradient background: Top-left #0a84ff (10, 132, 255) to Bottom-right #8a5cff (138, 92, 255)
    gt = (nx + ny) / 2.0
    bg_r = int(10 + gt * (138 - 10))
    bg_g = int(132 + gt * (92 - 132))
    bg_b = 255
    
    # Draw Inner Elements:
    # 1. Folder Back / Tab:
    # Tab at top left of icon
    in_tab = (0.24 <= nx <= 0.46 and 0.23 <= ny <= 0.33)
    # Folder body
    in_folder = (0.22 <= nx <= 0.78 and 0.30 <= ny <= 0.76)
    
    # 2. Envelope Emblem in the middle
    # Envelope bounds:
    # nx: 0.26 to 0.74, ny: 0.34 to 0.70
    in_env = (0.27 <= nx <= 0.73 and 0.36 <= ny <= 0.68)
    
    if in_env:
        # Envelope flap triangle:
        # From (0.27, 0.36) to (0.50, 0.54) to (0.73, 0.36)
        # Check fold line distance
        rel_x = (nx - 0.27) / 0.46
        expected_y = 0.36 + (0.54 - 0.36) * (1.0 - abs(rel_x - 0.5) * 2.0)
        
        # Bottom fold lines
        rel_y_bot = 0.68 - (0.68 - 0.54) * (1.0 - abs(rel_x - 0.5) * 2.0)

        # Border of envelope
        is_border = (nx < 0.29 or nx > 0.71 or ny < 0.38 or ny > 0.66)
        
        # Flap line
        is_flap_line = abs(ny - expected_y) < 0.02
        is_bot_fold = abs(ny - rel_y_bot) < 0.018 and ny > 0.54
        
        if is_flap_line or is_bot_fold:
            # Teal accent for envelope fold
            return 48, 213, 200, 255
        
        # Pure White body of envelope
        return 255, 255, 255, 255

    # Folder Tab top accent
    if in_tab:
        return 48, 213, 200, 230

    return bg_r, bg_g, bg_b, 255

def create_multi_ico(ico_path, sizes):
    """Create a Windows .ico file containing multiple resolution PNGs"""
    images = []
    for s in sizes:
        png_data = create_png_image(s, s, draw_email_to_folder_icon)
        images.append((s, png_data))

    # ICONDIR header: reserved (0), type (1 = icon), count
    count = len(images)
    icondir = struct.pack('<HHH', 0, 1, count)
    
    offset = 6 + (16 * count)
    entries = []
    
    for s, data in images:
        width_byte = 0 if s >= 256 else s
        height_byte = 0 if s >= 256 else s
        # width, height, colors (0), reserved (0), planes (1), bpp (32), bytesize, offset
        entry = struct.pack('<BBBBHHII', width_byte, height_byte, 0, 0, 1, 32, len(data), offset)
        entries.append(entry)
        offset += len(data)

    with open(ico_path, 'wb') as f:
        f.write(icondir)
        for e in entries:
            f.write(e)
        for _, data in images:
            f.write(data)
    print(f"Generated multi-size ICO: {ico_path} (Sizes: {sizes})")

def main():
    os.makedirs('assets', exist_ok=True)
    os.makedirs('build', exist_ok=True)
    
    # 1. Main 256x256 PNG for window & app
    png_256 = create_png_image(256, 256, draw_email_to_folder_icon)
    with open('assets/icon.png', 'wb') as f:
        f.write(png_256)
    print("Generated assets/icon.png (256x256)")

    # 2. Tray 32x32 PNG for crisp high-DPI Windows Tray
    png_32 = create_png_image(32, 32, draw_email_to_folder_icon)
    with open('assets/tray.png', 'wb') as f:
        f.write(png_32)
    print("Generated assets/tray.png (32x32)")

    # 3. Tray 16x16 PNG for standard 100% scale Windows Tray
    png_16 = create_png_image(16, 16, draw_email_to_folder_icon)
    with open('assets/tray-16.png', 'wb') as f:
        f.write(png_16)
    print("Generated assets/tray-16.png (16x16)")

    # 4. Multi-resolution ICO for Windows exe & taskbar
    create_multi_ico('assets/icon.ico', [256, 128, 64, 48, 32, 16])
    create_multi_ico('build/icon.ico', [256, 128, 64, 48, 32, 16])
    create_multi_ico('assets/tray.ico', [32, 16])

if __name__ == '__main__':
    main()
