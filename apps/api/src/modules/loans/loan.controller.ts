import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { LoanService } from './loan.service';
import { CreateLoanDto, UpdateLoanDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('loans')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('loans')
export class LoanController {
  constructor(private readonly loans: LoanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOAN_READ)
  @ApiOperation({ summary: 'List loans' })
  list(@CurrentUser() user: AuthUser) {
    return this.loans.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LOAN_APPROVE)
  @ApiOperation({ summary: 'Create a loan' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLoanDto) {
    return this.loans.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.LOAN_APPROVE)
  @ApiOperation({ summary: 'Update a loan (status, dates, counterparty)' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLoanDto) {
    return this.loans.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.LOAN_APPROVE)
  @ApiOperation({ summary: 'Delete a loan' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loans.remove(user, id);
  }
}
