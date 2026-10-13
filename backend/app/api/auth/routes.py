from app.core.dependencies import get_current_user
from app.models import User
from app.schemas.auth.change_password import ChangePasswordRequest

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.auth.register import RegisterRequest, RegisterResponse
from app.services.auth.auth_service import AuthService
from app.schemas.auth.login import LoginRequest, LoginResponse


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    request: RegisterRequest,
    db: Session = Depends(get_db),
):
    auth_service = AuthService(db)

    try:
        user = auth_service.register_user(
            full_name=request.full_name,
            email=request.email,
            password=request.password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return RegisterResponse(
        id=str(user.id),
        full_name=user.full_name,
        email=user.email,
        account_status=user.account_status.value,
        email_verified=user.email_verified,
    )

@router.post(
    "/login",
    response_model=LoginResponse,
)
def login(
    request: LoginRequest,
    db: Session = Depends(get_db),
):
    auth_service = AuthService(db)

    try:
        access_token = auth_service.login_user(
            email=request.email,
            password=request.password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
    )

@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
)
def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    auth_service = AuthService(db)

    try:
        auth_service.change_password(
            current_user,
            current_password=request.current_password,
            new_password=request.new_password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )