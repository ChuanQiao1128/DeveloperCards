#!/usr/bin/env python3
"""Offline wave cost gate: only IAM changes are admitted; billing remains unverified."""
import argparse
import json

# IAM isolation changes have no recurring resource charge. This does not approve their security policy.
IAM_ONLY = {'aws_iam_policy', 'aws_iam_role', 'aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'aws_iam_policy_attachment'}


def validate(plan):
    if not isinstance(plan, dict) or not isinstance(plan.get('format_version'), str) or not isinstance(plan.get('resource_changes'), list):
        raise ValueError('expected Terraform show -json with resource_changes list')
    for entry in plan['resource_changes']:
        if not isinstance(entry, dict) or entry.get('mode') not in ['data', 'managed']:
            raise ValueError('invalid resource change')
        change = entry.get('change')
        if not isinstance(change, dict) or not isinstance(change.get('actions'), list):
            raise ValueError('invalid change actions')
        actions = change['actions']
        if actions not in [['no-op'], ['create'], ['update'], ['delete'], ['delete', 'create'], ['create', 'delete'], ['read']]:
            raise ValueError('unsupported action')
        if entry['mode'] == 'data' or actions == ['no-op']:
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
