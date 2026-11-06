import os
from PIL import Image, ImageDraw

def create_siddarth_icon(size):
    # Create image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Outer circle gradient or background
    padding = max(1, int(size * 0.05))
    circle_box = [padding, padding, size - padding, size - padding]
    
    # Primary theme colors: Indigo/Purple
    bg_color = (79, 70, 229, 255) # Indigo 600
    draw.ellipse(circle_box, fill=bg_color)
    
    # Draw an inner subtle ring
    ring_pad = max(2, int(size * 0.12))
    ring_box = [ring_pad, ring_pad, size - ring_pad, size - ring_pad]
    draw.ellipse(ring_box, outline=(129, 140, 248, 180), width=max(1, int(size * 0.03)))
    
    # Draw central "S" or AI spark symbol
    center_x = size / 2
    center_y = size / 2
    spark_radius = size * 0.28
    
    # 4-pointed spark polygon
    spark_points = [
        (center_x, center_y - spark_radius),
        (center_x + spark_radius * 0.35, center_y - spark_radius * 0.35),
        (center_x + spark_radius, center_y),
        (center_x + spark_radius * 0.35, center_y + spark_radius * 0.35),
        (center_x, center_y + spark_radius),
        (center_x - spark_radius * 0.35, center_y + spark_radius * 0.35),
        (center_x - spark_radius, center_y),
        (center_x - spark_radius * 0.35, center_y - spark_radius * 0.35),
    ]
    draw.polygon(spark_points, fill=(255, 255, 255, 255))
    
    # Secondary spark dot
    dot_radius = max(1, int(size * 0.08))
    dot_x = center_x + spark_radius * 0.7
    dot_y = center_y - spark_radius * 0.7
    draw.ellipse([dot_x - dot_radius, dot_y - dot_radius, dot_x + dot_radius, dot_y + dot_radius], fill=(236, 72, 153, 255))
    
    return img

def main():
    os.makedirs('assets/icons', exist_ok=True)
    for s in [16, 32, 48, 128]:
        icon = create_siddarth_icon(s)
        icon.save(f'assets/icons/icon{s}.png', 'PNG')
        print(f"Generated assets/icons/icon{s}.png")

if __name__ == '__main__':
    main()

