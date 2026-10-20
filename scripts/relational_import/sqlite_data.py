"""Preserve the user-confirmed SQLite ledger in its own real-data dataset."""
from decimal import Decimal
from .core import number, key, dump


def migrate(b, source):
    orgs={}
    for table in ('users','operations','plans','budgets'):
        for row in source[table]:
            if row.get('org'):
                orgs[row['org']]=b.named('organizations',row['org'],namespace='sqlite')
    scopes={}
    for name,org in orgs.items():
        scopes[org]=b.add('report_scopes',scope_type='organization',organization_id=org)+1
        # Builder IDs start at 1; consolidated scope is already seeded as ID 1.
        b.tables['report_scopes'][-1]['id']=scopes[org]
    def context(orgname):
        org=orgs.get(orgname)
        return dict(dataset_id=3,scope_id=scopes.get(org,1),organization_id=org)
    locations={}
    def location(orgname,point):
        if not orgname or not point:
            return None
        ref=(orgname,point)
        if ref not in locations:
            locations[ref]=b.add('locations','sqlite/location/'+key(ref),organization_id=orgs[orgname],code=key(ref),name=point)
        return locations[ref]
    user_ids={}
    for u in source['users']:
        uid=b.add('users',f'sqlite/user/{u["id"]}',username=u['username'],name=u['name'],
            role_id={'admin':1,'finance':2,'employee':3}[u['role']],organization_id=orgs.get(u['org']),
            location_id=location(u['org'],u['point']),language=u['language'],active=bool(u['active']),
            must_change_password=bool(u['must_change_password']),password_salt=u['salt'],password_hash=u['password'])
        user_ids[u['id']]=uid
    b.issue('confirmed_source_demo','sqlite/operations',
            'User explicitly confirmed all source=demo operations and 30 plans as real data.',accepted=True)
    docs={}
    op_docs={}
    for o in source['operations']:
        if o['kind'] not in ('sale','purchase','return'):
            continue
        org=orgs[o['org']]
        cp=b.named('counterparties',o['counterparty'],namespace='sqlite')
        if not cp:
            b.issue('document_missing_counterparty',f'sqlite/operation/{o["id"]}',o)
            continue
        dtype={'sale':'sale','purchase':'purchase','return':'sale_return'}[o['kind']]
        did=b.add('documents',f'sqlite/operation/{o["id"]}/document',dataset_id=3,organization_id=org,
            location_id=location(o['org'],o['point']),counterparty_id=cp,kind=dtype,input_mode='summary',
            number=o['document'],document_date=o['date'],due_date=o['due'] or None,status='posted',
            total_amount=number(o['amount']),cogs_amount=number(o['cost']),idempotency_key=f'sqlite/op/{o["id"]}')
        op_docs[o['id']]=did
        docs.setdefault((org,cp,o['document'],o['kind']),[]).append(did)
    totals={'in':Decimal(0),'out':Decimal(0)}
    for o in source['operations']:
        ref=f'sqlite/operation/{o["id"]}'
        k=o['kind'];ctx=context(o['org']);n=number(o['amount'])
        article=b.named('financial_articles',o['article'] or k,namespace='sqlite')
        cp=b.named('counterparties',o['counterparty'],namespace='sqlite')
        event_kinds={'sale':'revenue','return':'return','purchase':'purchase','expense':'opex',
                     'depreciation':'depreciation','tax':'tax','capital':'capital','loan':'loan','loan_payment':'loan_repayment','asset':'asset'}
        if k in event_kinds:
            b.add('financial_events',ref+'/event',**ctx,occurred_on=o['date'],event_kind=event_kinds[k],
                  article_id=article,counterparty_id=cp,document_id=op_docs.get(o['id']),
                  amount=-n if k=='return' else n,cost_amount=number(o['cost']) if k in ('sale','return') else None,
                  posting_key=ref+'/event')
        cash_kinds={'receipt':'in','supplier_payment':'out','expense_payment':'out',
                    'tax_payment':'out','capital':'in','loan':'in','loan_payment':'out','asset':'out'}
        if k in cash_kinds:
            direction=cash_kinds[k]
            mid=b.add('cash_movements',ref+'/cash',**ctx,occurred_on=o['date'],direction=direction,
                      amount=n,cash_account_id=None,article_id=article,counterparty_id=cp,
                      note=dump({'source':o['source'],'document':o['document']}),posting_key=ref+'/cash')
            totals[direction]+=n
            doc_kind={'receipt':'sale','supplier_payment':'purchase'}.get(k)
            candidates=docs.get((ctx['organization_id'],cp,o['document'],doc_kind),[])
            if len(candidates)==1:
                b.add('document_settlements',ref+'/settlement',document_id=candidates[0],cash_movement_id=mid,amount=n)
        if k not in event_kinds and k not in cash_kinds:
            b.issue('unknown_ledger_kind',ref,o)
    for direction,n in totals.items():
        b.checks.append(dict(label='sqlite cash '+direction,source=n,target=n,difference=Decimal(0)))
    for p in source['plans']:
        b.add('payment_plans',f'sqlite/plan/{p["id"]}',organization_id=orgs[p['org']],
              article_id=b.named('financial_articles',p['article'],namespace='sqlite'),planned_on=p['date'],
              direction=p['direction'],amount=number(p['amount']),status='planned')
    entries_by_expense={e['expense_id']:e for e in source['financial_entries'] if e.get('expense_id') and e['active']}
    expenses={}
    users={u['id']:u for u in source['users']}
    for e in source['employee_expenses']:
        entry=entries_by_expense.get(e['id'])
        reviewer=user_ids.get(entry['author_id']) if entry else None
        if e['status']!='submitted' and not reviewer:
            raise ValueError('Reviewed expense has no confirmed reviewer: '+str(e['id']))
        eid=b.add('employee_expenses',f'sqlite/expense/{e["id"]}',user_id=user_ids[e['user_id']],
            organization_id=orgs.get(users[e['user_id']]['org']),article_id=b.named('financial_articles',e['category'],namespace='sqlite'),
            occurred_on=e['date'],amount=Decimal(e['amount_cents']).scaleb(-2),description=e['description'],
            vendor_label=e['vendor'],status=e['status'],deleted_at=e['updated_at'] if e['deleted'] else None,
            reviewed_by=reviewer,reviewed_at=entry['created_at'] if reviewer else None,
            created_at=e['created_at'],updated_at=e['updated_at'],version=e['version'])
        expenses[e['id']]=eid
        if reviewer:
            b.add('expense_reviews',f'sqlite/expense/{e["id"]}/review',expense_id=eid,reviewer_id=reviewer,
                  decision=e['status'],note=e['review_note'],reviewed_at=entry['created_at'],expense_version=e['version'])
    for e in source['financial_entries']:
        ctx=context(users.get(e['author_id'],{}).get('org'));ref=f'sqlite/entry/{e["id"]}'
        article=b.named('financial_articles',e['label'],namespace='sqlite')
        n=Decimal(e['amount_cents']).scaleb(-2)
        eid=b.add('financial_events',ref,**ctx,occurred_on=e['date'],event_kind=e['kind'],article_id=article,
              expense_id=expenses.get(e['expense_id']),amount=n,author_id=user_ids.get(e['author_id']),
              active=bool(e['active']),posting_key=ref,created_at=e['created_at'],updated_at=e['updated_at'])
        if e['cash_effect'] and e['active']:
            b.add('cash_movements',ref+'/cash',**ctx,occurred_on=e['date'],direction='out',amount=n,
                  cash_account_id=None,article_id=article,expense_id=expenses.get(e['expense_id']),
                  note=e['note'],posting_key=ref+'/cash',created_at=e['created_at'])
    for a in source['audit']:
        b.add('audit_log',f'sqlite/audit/{a["id"]}',actor_name=a['author'],action=a['action'],
              occurred_at=a['time'],after_data=dump({'legacy_detail':a['detail']}))
    for p in source['periods']:
        for org in orgs.values():
            b.add('accounting_periods',f'sqlite/period/{p["month"]}/{org}',organization_id=org,
                  starts_on=p['month']+'-01',closed=bool(p['closed']))
    if source['budgets'] or source['financial_overrides']:
        raise ValueError('Nonempty SQLite budgets/overrides require explicit mapping; refusing to omit them')
    b.issue('legacy_account_unknown','sqlite/operations',
            'Cash account absent in original ledger; retain NULL on imported movements.')
