"""Explore Alberta Water Wells MDB schema."""
import sys
mdb_path = r"C:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\abwells_extracted\Well_Reports.mdb"

try:
    import pyodbc
    print("pyodbc available")
    
    # Try various drivers
    drivers = [
        "{Microsoft Access Driver (*.mdb, *.accdb)}",
        "{Microsoft Access Driver (*.mdb)}",
        "Microsoft Access Driver (*.mdb)",
    ]
    
    conn = None
    for d in drivers:
        try:
            conn_str = f"DRIVER={d};DBQ={mdb_path}"
            print(f"  Trying: {d}")
            conn = pyodbc.connect(conn_str)
            print(f"  Success!")
            break
        except Exception as e:
            print(f"  Failed: {e}")
    
    if not conn:
        # Try with 64-bit only driver
        try:
            conn_str = f"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={mdb_path}"
            conn = pyodbc.connect(conn_str)
        except:
            pass
    
    if not conn:
        print("No MDB driver found. Installing mdbtools or mdbtables...")
        # Fall back to mdbtools CLI
        import subprocess
        result = subprocess.run(['mdb-tables', '-1', mdb_path], capture_output=True, text=True)
        if result.returncode == 0:
            tables = result.stdout.strip().split('\n')
            print(f"Tables (via mdb-tables):")
            for t in sorted(tables):
                if t.strip():
                    print(f"  {t.strip()}")
        else:
            print(f"mdb-tools not found either. Error: {result.stderr}")
            print("Looking for pandas based access...")
            try:
                import pandas as pd
                import subprocess
                # Check if mdbtools is installed
                result = subprocess.run(['where', 'mdb-export'], capture_output=True, text=True)
                if result.returncode != 0:
                    print("Need to install mdbtools. On Windows this needs WSL or a specific build.")
                    print("Alternative: use pandas pyarrow or sqlite conversion.")
                else:
                    print(f"mdb-export found at: {result.stdout.strip()}")
            except:
                pass
    else:
        cursor = conn.cursor()
        tables = []
        for row in cursor.tables():
            if row.table_type == 'TABLE':
                tables.append(row.table_name)
        
        print(f"\nTables found: {len(tables)}")
        for t in sorted(tables):
            print(f"\n  Table: {t}")
            try:
                cursor.execute(f"SELECT TOP 1 * FROM [{t}]")
                cols = [desc[0] for desc in cursor.description]
                print(f"    Columns: {len(cols)} columns")
                # Show first 10 cols
                for c in cols[:15]:
                    print(f"      - {c}")
                if len(cols) > 15:
                    print(f"      ... and {len(cols) - 15} more")
                # Show row count
                cursor.execute(f"SELECT COUNT(*) FROM [{t}]")
                count = cursor.fetchone()[0]
                print(f"    Rows: {count}")
            except Exception as e:
                print(f"    Error: {e}")
        
        conn.close()

except ImportError:
    print("pyodbc not installed. Try: pip install pyodbc")
except Exception as e:
    print(f"Error: {e}")