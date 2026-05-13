import csv
import os
from pathlib import Path

import psycopg2


CSV_PATH = Path(__file__).resolve().parent / "car rental sample_augmented_demo.csv"


def qident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def main() -> None:
    host = os.environ.get("CAR_DB_HOST", "34.203.45.126")
    port = int(os.environ.get("CAR_DB_PORT", "5432"))
    dbname = os.environ.get("CAR_DB_NAME", "cars_service")
    user = os.environ.get("CAR_DB_USER", "root")
    password = os.environ.get("CAR_DB_PASSWORD", "rootpassword")
    table = os.environ.get("CAR_DB_TABLE", "car_service")

    if not CSV_PATH.is_file():
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")

    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader)

    ddl_cols = ", ".join(f"{qident(h)} TEXT" for h in headers)
    table_ident = qident(table)

    conn = psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
    )
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {table_ident}")
            cur.execute(f"CREATE TABLE {table_ident} ({ddl_cols})")
            with CSV_PATH.open("r", encoding="utf-8") as csv_file:
                copy_sql = f"COPY {table_ident} ({', '.join(qident(h) for h in headers)}) FROM STDIN WITH CSV HEADER"
                cur.copy_expert(copy_sql, csv_file)
            cur.execute(f"SELECT COUNT(*) FROM {table_ident}")
            count = cur.fetchone()[0]
        conn.commit()
        print(f"Imported {count} rows into {dbname}.{table}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
