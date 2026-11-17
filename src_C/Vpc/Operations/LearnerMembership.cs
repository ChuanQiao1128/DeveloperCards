namespace RecallSmith.Lambda.Vpc.Operations;

public static partial class ConsoleOperations
{
  // Filters run before the page limit. The same evaluation time is bound into every cursor.
  internal const string LearnerDirectorySql = """
    with profiles as (
      select u.user_sub,u.email,u.created_at,u.last_seen_at,u.last_platform,u.last_version,
        r.app_user_id is not null as rc_present,
        lower(trim(coalesce(r.premium_env,''))) as rc_environment,
        case when r.expires_at_ms is not null then to_timestamp(r.expires_at_ms/1000.0) else null end as rc_expiry,
        case when r.expires_at_ms is not null then r.expires_at_ms > extract(epoch from $1::timestamptz)*1000
          else coalesce(r.premium_active,false) end as rc_active,
        coalesce(g.all_active,false) as all_active,coalesce(g.decks_active,false) as decks_active,
        g.all_expiry,g.decks_expiry,coalesce(g.has_history,false) as has_history,g.last_expiry
      from users u
      left join user_premium_state r on r.app_user_id=u.user_sub
      left join lateral (
        select bool_or(entitlement_key='premium_all' and (expires_at is null or expires_at>$1)) as all_active,
          bool_or(starts_with(entitlement_key,'deck:') and (expires_at is null or expires_at>$1)) as decks_active,
          max(expires_at) filter(where entitlement_key='premium_all' and (expires_at is null or expires_at>$1)) as all_expiry,
          case when bool_or(expires_at is null) filter(where starts_with(entitlement_key,'deck:') and (expires_at is null or expires_at>$1)) then null
            else max(expires_at) filter(where starts_with(entitlement_key,'deck:') and (expires_at is null or expires_at>$1)) end as decks_expiry,
          count(*)>0 as has_history,max(expires_at) as last_expiry
        from user_entitlements where user_sub=u.user_sub and tier='premium'
          and (entitlement_key='premium_all' or starts_with(entitlement_key,'deck:'))
      ) g on true
      where u.created_at <= $1 and u.user_sub COLLATE "C" > $2 COLLATE "C"
        and (u.user_sub ilike $3 escape '\' or u.email ilike $3 escape '\')
    ), access as (
      select *,
        case when rc_active or all_active or decks_active then 'premium' else 'free' end as membership_tier,
        case when rc_active then 'revenuecat' when all_active or decks_active then 'legacy'
          when rc_present then 'revenuecat' when has_history then 'legacy' else 'none' end as membership_source,
        case when rc_active or all_active then 'all' when decks_active then 'selected_decks' else 'none' end as membership_scope,
        case when rc_active then rc_expiry when all_active then all_expiry when decks_active then decks_expiry
          else greatest(rc_expiry,last_expiry) end as membership_expiry
      from profiles
    ), membership as (
      select *,case when membership_tier='premium' then 'active' when membership_expiry<=$1 then 'expired'
        when rc_present or has_history then 'inactive' else 'free' end as membership_status
      from access
    )
    select * from membership
    where ($5='all' or membership_tier=$5)
      and ($6='all' or ($6 in ('production','sandbox') and membership_source='revenuecat' and rc_environment=$6)
        or ($6 in ('legacy','none','unknown') and membership_source=$6))
      and ($7='all' or ($7='expired' and membership_status='expired')
        or ($7='next7' and membership_tier='premium' and membership_expiry>$1 and membership_expiry<=$1::timestamptz+interval '7 days')
        or ($7='next30' and membership_tier='premium' and membership_expiry>$1 and membership_expiry<=$1::timestamptz+interval '30 days'))
    order by user_sub COLLATE "C" limit $4
    """;

  private static object? MembershipRow(Dictionary<string, object?> row)
  {
    if (!row.ContainsKey("membership_tier")) return null;
    var source = Convert.ToString(row["membership_source"]);
    var blockSandbox = Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM")?.Trim().ToLowerInvariant() is "1" or "true" or "yes";
    return new
    {
      state = "known", tier = row["membership_tier"], status = row["membership_status"], source,
      scope = row["membership_scope"], expiresAt = row["membership_expiry"],
      environment = source == "revenuecat" && Convert.ToString(row["rc_environment"]) is { Length: > 0 } environment ? environment : null,
      premiumDownloadEligible = row["rc_active"] is true && !(blockSandbox && Convert.ToString(row["rc_environment"]) == "sandbox"),
    };
  }
}
