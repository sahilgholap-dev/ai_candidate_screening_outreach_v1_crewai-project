"""candidate review workflow

Revision ID: f05aa12942e2
Revises: bf3fe87525fc
Create Date: 2026-07-30 10:12:27.370151

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f05aa12942e2'
down_revision: Union[str, Sequence[str], None] = 'bf3fe87525fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(
            sa.Column("review_status", sa.String(), nullable=False, server_default="pending")
        )
        batch_op.add_column(sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("sent_by", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("sent_email", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("sent_sms", sa.Text(), nullable=True))
    op.execute(
        "UPDATE candidates SET review_status = 'approved' WHERE outreach_approved"
    )
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_column("outreach_approved")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(
            sa.Column(
                "outreach_approved",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    op.execute(
        "UPDATE candidates SET outreach_approved = TRUE WHERE review_status = 'approved'"
    )
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_column("sent_sms")
        batch_op.drop_column("sent_email")
        batch_op.drop_column("sent_by")
        batch_op.drop_column("sent_at")
        batch_op.drop_column("review_status")
