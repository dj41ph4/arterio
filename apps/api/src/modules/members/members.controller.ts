import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { MembersService } from './members.service';
import { InviteMemberDto, UpdateMemberDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('members')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.USER_MANAGE)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({ summary: 'List organization members with their roles' })
  list(@CurrentUser() user: AuthUser) {
    return this.members.list(user);
  }

  @Get('roles')
  @ApiOperation({ summary: 'List roles available to assign' })
  listRoles(@CurrentUser() user: AuthUser) {
    return this.members.listRoles(user);
  }

  @Post()
  @ApiOperation({ summary: 'Add a member (bootstrap account — sets a real password on first login)' })
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteMemberDto) {
    return this.members.invite(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Change a member's role or status" })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disable a member (soft-remove, preserves history)' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.remove(user, id);
  }

  @Post(':id/reset-password')
  @ApiOperation({
    summary: 'Reset a member back to bootstrap state',
    description: 'No outbound-email infra to support self-service reset — an admin resets the member, who then sets a fresh password on their next login. Revokes all of their active sessions.',
  })
  resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.resetPassword(user, id);
  }
}
