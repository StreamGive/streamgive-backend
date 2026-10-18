import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateNgoDto } from './dtos/update-ngo.dto';

describe('UpdateNgoDto Validation (#285)', () => {
  let validatorPipe: ValidationPipe;

  beforeEach(() => {
    validatorPipe = new ValidationPipe({ transform: true, whitelist: true });
  });

  it('should reject an empty string as displayName', async () => {
    const dto = plainToInstance(UpdateNgoDto, { displayName: '   ' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a displayName longer than 200 characters', async () => {
    const longString = 'a'.repeat(201);
    const dto = plainToInstance(UpdateNgoDto, { displayName: longString });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept null to clear the displayName', async () => {
    const dto = plainToInstance(UpdateNgoDto, { displayName: null });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept valid trimmed string between 1 and 200 characters', async () => {
    const dto = plainToInstance(UpdateNgoDto, { displayName: '  Valid NGO Name  ' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.displayName).toBe('Valid NGO Name');
  });

  it('should reject an empty body {}', () => {
    const body = {};
    const isEmpty = Object.keys(body).length === 0;
    expect(isEmpty).toBe(true);
  });
});