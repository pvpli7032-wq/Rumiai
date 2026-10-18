import paramiko, time
HOST="43.242.194.115"
for attempt in range(3):
    c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect(HOST,22,"root","kddsXOLC9832",timeout=20,allow_agent=False,look_for_keys=False)
        print("SSH OK attempt",attempt)
        i,o,e=c.exec_command("hostname; ls /www/wwwroot; pm2 list 2>/dev/null | head -20")
        print(o.read().decode()); print(e.read().decode()[:300])
        c.close(); break
    except Exception as ex:
        print("attempt",attempt,"ERR",type(ex).__name__,str(ex)[:100])
        time.sleep(3)
