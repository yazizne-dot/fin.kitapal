"""Read stored values and formulas from OOXML; never evaluate or modify source files."""
import zipfile, xml.etree.ElementTree as ET, json, sys, hashlib, datetime
from pathlib import Path
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
def read(path):
 with zipfile.ZipFile(path) as z:
  strings=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
  rels={r.attrib['Id']:'xl/'+r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  out={}
  for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',NS):
   tree=ET.fromstring(z.read(rels[sheet.attrib[R]])); cells={}; shared={}
   for c in tree.findall('.//s:sheetData/s:row/s:c',NS):
    v=c.find('s:v',NS);f=c.find('s:f',NS);t=c.attrib.get('t');value=v.text if v is not None else None
    if t=='s' and value is not None:value=strings[int(value)]
    elif t=='inlineStr':value=''.join(c.find('s:is',NS).itertext())
    elif value is not None and t not in ('str','e','b'):
     try:value=float(value);value=int(value) if value.is_integer() else value
     except ValueError:pass
    if f is not None and f.text and f.attrib.get('t')=='shared':shared[f.attrib.get('si')]=c.attrib['r']
    if value is not None or f is not None:cells[c.attrib['r']]={'value':value,**({'formula':f.text,'formulaAttributes':f.attrib,**({'sharedFormulaOrigin':shared.get(f.attrib.get('si'))} if f.attrib.get('t')=='shared' else {})} if f is not None else {}),**({'error':True} if t=='e' else {})}
   out[sheet.attrib['name']]={'cells':cells,'dimension':tree.find('s:dimension',NS).attrib.get('ref'),'hidden':sheet.attrib.get('state')=='hidden'}
  return {'importedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'file':Path(path).name,'sha256':hashlib.file_digest(open(path,'rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(Path(path).read_bytes()).hexdigest(),'sheets':out}
if __name__=='__main__':
 data=read(sys.argv[1]);Path(sys.argv[2]).write_text(json.dumps(data,ensure_ascii=False));print(json.dumps({k:{'cells':len(v['cells']),'dimension':v['dimension'],'hidden':v['hidden']} for k,v in data['sheets'].items()},ensure_ascii=False,indent=2))
