import os
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""
    
    # OAuth Configuration
    OAUTH_WELL_KNOWN_URL: str = os.getenv("OAUTH_WELL_KNOWN_URL", "")
    OAUTH_JWKS_URI: str = os.getenv("OAUTH_JWKS_URI", "")
    OAUTH_ISSUER: str = os.getenv("OAUTH_ISSUER", "")
    OAUTH_AUDIENCE: str = os.getenv("OAUTH_AUDIENCE", "")
    
    # Server Configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    @classmethod
    def validate_required(cls) -> None:
        """Validate that all required OAuth settings are present.
        
        Raises:
            ValueError: If any required setting is missing.
        """
        required_settings = {
            "OAUTH_WELL_KNOWN_URL": cls.OAUTH_WELL_KNOWN_URL,
            "OAUTH_JWKS_URI": cls.OAUTH_JWKS_URI,
            "OAUTH_ISSUER": cls.OAUTH_ISSUER,
            "OAUTH_AUDIENCE": cls.OAUTH_AUDIENCE,
        }
        
        missing = [key for key, value in required_settings.items() if not value]
        if missing:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing)}"
            )


# Create a singleton instance for easy access
settings = Settings()

