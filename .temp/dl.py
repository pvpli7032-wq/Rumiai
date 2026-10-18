import paramiko, hashlib, sys
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('43.242.194.115',22,'root','1314520Gao...',timeout=25)
s=c.open_sftp()
s.get('/tmp/live-src.tgz', '.temp/live-src.tgz')
s.close(); c.close()
h=hashlib.md5(open('.temp/live-src.tgz','rb').read()).hexdigest()
print("md5", h)
