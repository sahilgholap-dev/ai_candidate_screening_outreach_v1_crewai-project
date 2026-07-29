"""watched-folder columns

Revision ID: 0db983aba19a
Revises: 670058685707
Create Date: 2026-07-29 16:44:25.066861

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0db983aba19a'
down_revision: Union[str, Sequence[str], None] = '670058685707'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("campaigns") as batch_op:
        batch_op.add_column(
            sa.Column("intake_mode", sa.String(), nullable=False, server_default="upload")
        )
        batch_op.add_column(sa.Column("folder_name", sa.String(), nullable=True))
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(sa.Column("content_hash", sa.String(), nullable=True))
        batch_op.create_index("ix_candidates_content_hash", ["content_hash"])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_index("ix_candidates_content_hash")
        batch_op.drop_column("content_hash")
    with op.batch_alter_table("campaigns") as batch_op:
        batch_op.drop_column("folder_name")
        batch_op.drop_column("intake_mode")
