from fastmcp import FastMCP, Context
from fastmcp.server.auth.providers.jwt import JWTVerifier
from mcp.server.auth.middleware.auth_context import get_access_token
from datetime import datetime
from starlette.requests import Request
from starlette.responses import RedirectResponse
from settings import settings

# Configure JWT verification using JWKS
token_verifier = JWTVerifier(
    jwks_uri=settings.OAUTH_JWKS_URI,
    issuer=settings.OAUTH_ISSUER,
    audience=settings.OAUTH_AUDIENCE,
)

# Initialize FastMCP server
mcp = FastMCP("sample-oauth-mcp-server")

# Forward .well-known/oauth-authorization-server to the actual OAuth server
@mcp.custom_route("/.well-known/oauth-authorization-server", methods=["GET", "HEAD", "OPTIONS"], include_in_schema=False)
async def oauth_well_known(request: Request):
    """Redirect to the upstream OAuth server's well-known endpoint."""
    return RedirectResponse(url=settings.OAUTH_WELL_KNOWN_URL, status_code=307)

@mcp.tool()
def get_me(ctx: Context) -> dict:
    """
    Get authenticated user information from the verified JWT token.
    """    
    claims = get_access_token().claims
    
    return {
        "user_id": claims.get('sub', 'N/A'),
        "uid": claims.get('uid'),
        "issuer": claims.get('iss'),
        "audience": claims.get('aud'),
        "client_id": claims.get('cid'),
        "scopes": claims.get('scp', claims.get('scope', [])),
        "issued_at": datetime.fromtimestamp(claims['iat']).isoformat() if claims.get('iat') else None,
        "expires_at": datetime.fromtimestamp(claims['exp']).isoformat() if claims.get('exp') else None,
        "token_id": claims.get('jti'),
    }

if __name__ == "__main__":
    # stateless_http=True is required for streamable-http transport
    mcp.run(transport="streamable-http", host=settings.HOST, port=settings.PORT, stateless_http=True)

