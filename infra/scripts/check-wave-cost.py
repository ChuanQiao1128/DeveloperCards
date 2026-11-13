#!/usr/bin/env python3
"""Offline wave cost gate: only IAM changes are admitted; billing remains unverified."""
import argparse
import json
import re

# IAM isolation changes have no recurring resource charge. This does not approve their security policy.
IAM_ONLY = {'aws_iam_policy', 'aws_iam_role', 'aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'aws_iam_policy_attachment'}


def validate(plan):
    if not isinstance(plan, dict) or not isinstance(plan.get('format_version'), str) or not isinstance(plan.get('resource_changes'), list):
        raise ValueError('expected Terraform show -json with resource_changes list')
    if not re.fullmatch(r'1\.\d+', plan['format_version']):
        raise ValueError('unsupported Terraform plan format version')
    # Older supported JSON formats omit these fields. When present, incomplete
    # or deferred work is not evidence of an IAM-only complete resource delta.
    if ('complete' in plan and plan['complete'] is not True) or plan.get('errored', False) is not False:
        raise ValueError('incomplete or errored Terraform plan')
    if 'deferred_changes' in plan and plan['deferred_changes'] != []:
        raise ValueError('deferred Terraform changes are not cost-verifiable')
    for entry in plan['resource_changes']:
        if not isinstance(entry, dict) or entry.get('mode') not in ['data', 'managed']:
            raise ValueError('invalid resource change')
        change = entry.get('change')
        if not isinstance(change, dict) or not isinstance(change.get('actions'), list):
            raise ValueError('invalid change actions')
        actions = change['actions']
        if actions not in [['no-op'], ['create'], ['update'], ['delete'], ['delete', 'create'], ['create', 'delete'], ['read']]:
            raise ValueError('unsupported action')
        if entry['mode'] == 'data':
            if actions not in [['read'], ['no-op']]:
                raise ValueError('invalid data resource actions')
            continue
        if actions == ['no-op']:
            continue
        if entry.get('type') not in IAM_ONLY:
            raise ValueError('non-IAM resource change rejected: ' + str(entry.get('address')))
        if change.get('after_unknown') not in [None, {}] and not isinstance(change['after_unknown'], dict):
            raise ValueError('invalid unknown values')
    return True


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', required=True)
    a = p.parse_args()
    try:
        with open(a.plan) as source:
            validate(json.load(source))
    except (ValueError, OSError) as ex:
        p.exit(1, 'COST GUARD REJECTED: ' + str(ex) + '\n')
    print('COST GUARD PASS (offline plan only; actual billing UNKNOWN)')


if __name__ == '__main__':
    main()
