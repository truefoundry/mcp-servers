import os
from fastmcp import FastMCP, Context
from fastmcp.server.auth.providers.jwt import JWTVerifier
from mcp.server.auth.middleware.auth_context import get_access_token
from datetime import datetime


# Configure JWT verification
verifier = JWTVerifier(
    jwks_uri=os.getenv("OAUTH_JWKS_URI"),
    issuer=os.getenv("OAUTH_ISSUER"),
    audience=os.getenv("OAUTH_AUDIENCE"),
)

# Initialize FastMCP server with JWT authentication
mcp = FastMCP("sample-oauth-mcp-server", auth=verifier)

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
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8000)

