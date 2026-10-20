"""Dump the current qarzhy schema without sessions. Credentials never enter argv."""
import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def parse_settings(text):
    settings={}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        name,value=line.split('=',1)
        name=name.strip()
        if name not in ('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE'):
            raise ValueError('Unknown PostgreSQL setting')
        value=value.strip()
        if len(value)>=2 and value[0] in ('"',"'") and value[-1]==value[0]:value=value[1:-1]
        settings[name]=value
    return settings


def main():
    settings=ROOT/'.env.pg-backup.local'
    env=os.environ.copy()
    env.update(parse_settings(settings.read_text(encoding='utf-8')))
    if not all(env.get(k) for k in ('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD')):
        raise SystemExit('Fill PGUSER and PGPASSWORD in .env.pg-backup.local; do not send passwords in chat.')
    binary=shutil.which('pg_dump') or '/opt/homebrew/opt/libpq/bin/pg_dump'
    if not Path(binary).is_file():raise SystemExit('Install PostgreSQL client tools (libpq).')
    os.umask(0o077)
    outdir=ROOT/'data/backups'
    outdir.mkdir(parents=True,exist_ok=True)
    out=outdir/('qarzhy-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.dump')
    try:
        subprocess.run([binary,'--format=custom','--schema=qarzhy','--no-owner','--no-acl',
            '--exclude-table-data=qarzhy.sessions','--no-password','--file='+str(out)],env=env,check=True)
        restore=Path(binary).with_name('pg_restore')
        listing=subprocess.run([str(restore),'--list',str(out)],capture_output=True,text=True,check=True).stdout
        if 'TABLE DATA qarzhy sessions ' in listing:raise RuntimeError('Session data unexpectedly included')
        if 'TABLE DATA qarzhy users ' not in listing:raise RuntimeError('Expected user data absent')
        psql=Path(binary).with_name('psql')
        check_sql="""SELECT json_build_object(
            'server_version',current_setting('server_version'),
            'users',(SELECT count(*) FROM qarzhy.users),
            'documents',(SELECT count(*) FROM qarzhy.documents),
            'payment_plans',(SELECT count(*) FROM qarzhy.payment_plans),
            'cash_movements',(SELECT count(*) FROM qarzhy.cash_movements),
            'open_issues',(SELECT count(*) FROM qarzhy.import_issues WHERE status='open'),
            'source_correction_applied',EXISTS(SELECT 1 FROM qarzhy.schema_migrations WHERE version='0002_relational_source_resolution'))"""
        source_check=subprocess.run([str(psql),'-X','--no-password','-A','-t','-v','ON_ERROR_STOP=1','-c',check_sql],
            env=env,capture_output=True,text=True,check=True)
        source_state=json.loads(source_check.stdout)
        manifest=dict(file=out.name,sha256=hashlib.sha256(out.read_bytes()).hexdigest(),
            format='PostgreSQL custom',schema='qarzhy',sessions_excluded=True,
            archive_entries=len([line for line in listing.splitlines() if line and not line.startswith(';')]),
            source_state_checked_after_dump=source_state,
            validation='archive directory readable; restore verification required')
        out.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(manifest))
    except Exception:
        out.unlink(missing_ok=True)
        raise


if __name__=='__main__':main()
