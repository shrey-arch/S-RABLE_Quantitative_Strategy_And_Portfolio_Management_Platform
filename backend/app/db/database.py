# backend/app/db/database.py

from sqlalchemy import create_engine

from app.config import settings

# The database is remote (Supabase), reached through a connection pooler, and a
# pooler drops connections that have been idle for a while. A pooled connection
# handed out after that is already dead, and the request fails with a 500 on
# something as ordinary as GET /instruments. Two settings prevent it:
#   * pool_pre_ping - check the connection is alive before handing it over, and
#     quietly replace it if not (one cheap round trip per checkout);
#   * pool_recycle - never reuse a connection older than five minutes, which is
#     under the pooler's own idle timeout.
#
# The sizes are left at SQLAlchemy's defaults (5, plus 10 overflow) on purpose.
# They were briefly raised to 10 and 20 on the reasoning that the browser suite
# drives eight workers at once - but a managed pooler limits how many clients it
# will accept, and asking it for thirty connections can be refused where fifteen
# is not. Opening more connections is not the same as having more capacity, and
# the default has carried this load from the start.
engine = create_engine(
    settings.database_url,
    echo=settings.debug,  # Print SQL queries in development
    future=True,
    pool_pre_ping=True,
    pool_recycle=300,
)
