-- Matches the Workbench Context Provider's exact normalized MPN predicate:
--   where upper(trim(mpn)) = $1
-- It is idempotent for existing production databases and does not alter data.
create index if not exists quote_lines_mpn_normalized_idx
  on quote_lines (upper(trim(mpn)));
