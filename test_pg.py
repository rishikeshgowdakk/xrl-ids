import psycopg2
try:
    conn = psycopg2.connect("dbname='xrl_idars' user='postgres'")
    cur = conn.cursor()
    cur.execute("SELECT source_ip, destination_ip, protocol, event_mode FROM security_events ORDER BY timestamp DESC LIMIT 5;")
    for row in cur.fetchall():
        print(row)
except Exception as e:
    print(e)
