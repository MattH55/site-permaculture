import zipfile, os

src = r"C:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Contours_Intermittent_4993802787430523244.zip"
dst = r"C:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Expanding Edge\site-design\data\contours"

os.makedirs(dst, exist_ok=True)

with zipfile.ZipFile(src, 'r') as z:
    for name in z.namelist():
        z.extract(name, dst)
        print(f"Extracted: {name}")

print(f"\nDone. Files in {dst}:")
for f in os.listdir(dst):
    full = os.path.join(dst, f)
    size = os.path.getsize(full) if os.path.isfile(full) else 0
    print(f"  {f} ({size:,} bytes)")