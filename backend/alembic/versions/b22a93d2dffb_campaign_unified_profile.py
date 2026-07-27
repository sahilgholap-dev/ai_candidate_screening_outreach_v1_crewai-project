"""campaign unified_profile: store the Stage 1 checklist per campaign

Revision ID: b22a93d2dffb
Revises: 5beb0b4b14cb
Create Date: 2026-07-27 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b22a93d2dffb'
down_revision: Union[str, Sequence[str], None] = '5beb0b4b14cb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.add_column(sa.Column('unified_profile', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.drop_column('unified_profile')
