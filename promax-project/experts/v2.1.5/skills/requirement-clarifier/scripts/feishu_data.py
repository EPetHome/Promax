#!/usr/bin/env python3
"""Explicit business table access; shares local app credentials, never telemetry targets."""
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlencode
import uuid
import feishu_usage as u


def business_create(api, config, base, table, fields, operation_id, path):
    protected = set(config.get('protected_table_ids', [])) | {config.get('detail_table'), config.get('summary_table')}
    if table in protected:
        raise ValueError('采集统计表不能作为业务需求写入目标')
    if not isinstance(fields, dict) or not fields or any(not isinstance(k,str) or not k for k in fields):
        raise ValueError('fields 文件须为字段名到值的非空 JSON 对象')
    with u.receipt_lock(path):
        r=u.read(path) if path.exists() else {'base_token':base, 'table_id':table,'fields':fields,'status':'pending'}
        if (r['base_token'],r['table_id'],r['fields']) != (base,table,fields):
            raise ValueError('同一 operation_id 的目标和字段不可改变')
        u.save(path,r)
        if not r.get('record_id'):
            if r.get('attempted'):
                raise RuntimeError('业务创建结果未知，请按业务唯一 ID 核对；不能换 operation_id 盲目重试')
            r['attempted']=True;u.save(path,r)
            result=api('POST','/tables/'+table+'/records?'+urlencode({'client_token':operation_id}),{'fields':fields})
            r['record_id']=u.identifier(result.get('record',{}).get('record_id'));u.save(path,r)
        record=api('GET','/tables/'+table+'/records/'+r['record_id']).get('record',{})
        def equal(key,value):
            actual=record.get('fields',{}).get(key)
            if isinstance(value,dict) and 'link' in value:
                return isinstance(actual,dict) and actual.get('link')==value['link']
            if isinstance(value,(dict,list,bool)):
                return actual==value
            return u.matches({key:actual},{key:value})
        if record.get('record_id')!=r['record_id'] or not all(equal(k,v) for k,v in fields.items()):
            raise RuntimeError('业务记录已创建，读回未匹配；保留原回执')
        r['status']='verified';u.save(path,r)
        return {'status':'verified','record_id':r['record_id'],'receipt':str(path)}


def main():
    p=argparse.ArgumentParser(description='显式目标的飞书业务数据读取/录入；不自动连接旧周报或需求池')
    p.add_argument('--config',type=Path)
    sub=p.add_subparsers(dest='action',required=True)
    for op in ('tables','fields','records','create-record'):
        q=sub.add_parser(op);q.add_argument('--base-token',required=True)
        if op!='tables':q.add_argument('--table-id',required=True)
        if op=='create-record':
            q.add_argument('--fields-file',type=Path,required=True)
            q.add_argument('--operation-id',required=True,help='由执行者生成并保留 UUID；重试沿用')
        else:q.add_argument('--output',type=Path,required=True)
    for op in ('sheets','sheet-values'):
        q=sub.add_parser(op);q.add_argument('--spreadsheet-token',required=True)
        q.add_argument('--output',type=Path,required=True)
        if op=='sheet-values':q.add_argument('--range',required=True,help='已核实的 sheet_id!A1:Z500 范围')
    args=p.parse_args()
    try:
        config=u.load_config(args.config)
        args.config=args.config if args.config is not None else u.HOME/'config.json'
        if args.action in ('sheets','sheet-values'):
            token=u.authenticate(config)
            spreadsheet=u.identifier(args.spreadsheet_token)
            if args.action=='sheets':
                path='/sheets/v3/spreadsheets/'+spreadsheet+'/sheets/query'
            else:
                if not re.fullmatch(r'[A-Za-z0-9_-]+![A-Za-z]+[1-9][0-9]*:[A-Za-z]+[1-9][0-9]*',args.range):
                    raise ValueError('范围须为 sheet_id!A1:Z500，不能注入路径或查询参数')
                path='/sheets/v2/spreadsheets/'+spreadsheet+'/values/'+quote(args.range,safe='')
            data=u.request('GET',path,token=token).get('data',{})
            u.save(args.output,data)
            result={'status':'saved','output':str(args.output)}
        else:
            base=u.identifier(args.base_token)
            target=dict(config,base_token=base)
            api=u.connect(target)
            table=u.identifier(args.table_id) if args.action!='tables' else None
            if args.action=='create-record':
                operation=str(uuid.UUID(args.operation_id))
                path=args.config.parent/'business-receipts'/(operation+'.json')
                result=business_create(api,config,base,table,u.read(args.fields_file),operation,path)
            else:
                suffix='/tables' if args.action=='tables' else '/tables/'+table+'/'+args.action
                data=u.items(api,suffix)
                u.save(args.output,{'items':data,'total':len(data),'has_more':False})
                result={'status':'saved','count':len(data),'output':str(args.output)}
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except Exception as exc:
        message=str(exc) if type(exc) in (ValueError,RuntimeError) else type(exc).__name__
        print(json.dumps({'status':'not_verified','error':message},ensure_ascii=False),file=sys.stderr);return 2


if __name__=='__main__':
    raise SystemExit(main())
